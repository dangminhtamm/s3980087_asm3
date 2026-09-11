import type { Order } from '../domain/entities/order.js';
import {
  fallbackRoutingMatrix,
  optimizeSequence,
  type RoutingMatrix,
} from '../domain/route-optimizer.js';
import { durationMsSince, emitMetrics } from '../observability/metrics.js';
import type { RoutePlan, RoutingPoint, RoutingPort } from '../ports/routing.port.js';

export type { RoutePlan, RoutePlanStop, RoutingPoint } from '../ports/routing.port.js';

export { optimizeSequence } from '../domain/route-optimizer.js';

export class RoutingService implements RoutingPort {
  public constructor(
    private readonly provider = 'straight-line',
    private readonly baseUrl = 'https://router.project-osrm.org',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async plan(
    origin: RoutingPoint,
    orders: Order[],
    departureAt: string,
    manualOrderIds?: string[],
  ): Promise<RoutePlan> {
    const planStartedAt = process.hrtime.bigint();
    const points = [origin, ...orders.map(({ lat, lng }) => ({ lat, lng }))];
    const matrix = await this.getMatrix(points);
    const optimizationStartedAt = process.hrtime.bigint();
    const sequence = manualOrderIds
      ? manualOrderIds.map((id) => orders.findIndex((order) => order.orderId === id) + 1)
      : optimizeSequence(matrix, orders, departureAt);
    emitMetrics(
      [
        {
          name: 'RouteOptimizationDuration',
          value: durationMsSince(optimizationStartedAt),
          unit: 'Milliseconds',
        },
        { name: 'RouteOptimizationCount', value: 1, unit: 'Count' },
      ],
      {
        Mode: manualOrderIds ? 'manual' : 'automatic',
        StopBucket: this.stopBucket(orders.length),
      },
    );
    let cursor = Date.parse(departureAt);
    let previous = 0;
    let distance = 0;
    let duration = 0;
    const stops = sequence.map((pointIndex, index) => {
      const order = orders[pointIndex - 1]!;
      const travelDuration = Math.round(matrix.durations[previous]?.[pointIndex] ?? 0);
      const travelDistance = Math.round(matrix.distances[previous]?.[pointIndex] ?? 0);
      cursor += travelDuration * 1000;
      if (order.timeWindowStart) cursor = Math.max(cursor, Date.parse(order.timeWindowStart));
      const arrival = new Date(cursor).toISOString();
      cursor += order.serviceDurationMinutes * 60_000;
      const departure = new Date(cursor).toISOString();
      distance += travelDistance;
      duration = Math.round((cursor - Date.parse(departureAt)) / 1000);
      previous = pointIndex;
      return {
        orderId: order.orderId,
        sequence: index + 1,
        plannedArrivalAt: arrival,
        plannedDepartureAt: departure,
        plannedTravelDurationSeconds: travelDuration,
        plannedDistanceMeters: travelDistance,
      };
    });
    const orderedPoints = [origin, ...sequence.map((index) => points[index]!)];
    const geometry =
      matrix.provider === 'osrm'
        ? await this.getGeometry(orderedPoints).catch(() =>
            orderedPoints.map(({ lat, lng }) => [lat, lng] as [number, number]),
          )
        : orderedPoints.map(({ lat, lng }) => [lat, lng] as [number, number]);
    emitMetrics(
      [
        {
          name: 'RoutePlanningDuration',
          value: durationMsSince(planStartedAt),
          unit: 'Milliseconds',
        },
      ],
      {
        Provider: matrix.provider,
        StopBucket: this.stopBucket(orders.length),
      },
    );
    return {
      stops,
      plannedDistanceMeters: distance,
      plannedDurationSeconds: duration,
      geometry,
      provider: matrix.provider,
    };
  }

  private async getMatrix(points: RoutingPoint[]): Promise<RoutingMatrix> {
    if (this.provider !== 'osrm') {
      emitMetrics([{ name: 'RoutingFallbackCount', value: 1, unit: 'Count' }], {
        Provider: 'straight-line',
        Reason: 'configured',
        Operation: 'matrix',
      });
      return fallbackRoutingMatrix(points);
    }
    const startedAt = process.hrtime.bigint();
    try {
      const coordinates = points.map(({ lat, lng }) => `${lng},${lat}`).join(';');
      const response = await this.fetcher(
        `${this.baseUrl}/table/v1/driving/${coordinates}?annotations=duration,distance`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) throw new Error('OSRM matrix failed');
      const body = (await response.json()) as {
        code: string;
        durations: Array<Array<number | null>>;
        distances: Array<Array<number | null>>;
      };
      if (body.code !== 'Ok') throw new Error('OSRM matrix rejected coordinates');
      const matrix = {
        durations: body.durations.map((row) =>
          row.map((value) => value ?? Number.MAX_SAFE_INTEGER),
        ),
        distances: body.distances.map((row) =>
          row.map((value) => value ?? Number.MAX_SAFE_INTEGER),
        ),
        provider: 'osrm',
      };
      emitMetrics(
        [
          {
            name: 'RoutingProviderDuration',
            value: durationMsSince(startedAt),
            unit: 'Milliseconds',
          },
          { name: 'RoutingProviderRequestCount', value: 1, unit: 'Count' },
        ],
        { Provider: 'osrm', Operation: 'matrix', Outcome: 'success' },
      );
      return matrix;
    } catch (error: unknown) {
      emitMetrics(
        [
          {
            name: 'RoutingProviderDuration',
            value: durationMsSince(startedAt),
            unit: 'Milliseconds',
          },
          { name: 'RoutingProviderRequestCount', value: 1, unit: 'Count' },
          { name: 'RoutingProviderErrorCount', value: 1, unit: 'Count' },
          { name: 'RoutingFallbackCount', value: 1, unit: 'Count' },
        ],
        { Provider: 'osrm', Operation: 'matrix', Outcome: 'fallback' },
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      );
      return fallbackRoutingMatrix(points);
    }
  }

  private async getGeometry(points: RoutingPoint[]): Promise<Array<[number, number]>> {
    const startedAt = process.hrtime.bigint();
    const coordinates = points.map(({ lat, lng }) => `${lng},${lat}`).join(';');
    try {
      const response = await this.fetcher(
        `${this.baseUrl}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) throw new Error('OSRM route failed');
      const body = (await response.json()) as {
        routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>;
      };
      emitMetrics(
        [
          {
            name: 'RoutingProviderDuration',
            value: durationMsSince(startedAt),
            unit: 'Milliseconds',
          },
          { name: 'RoutingProviderRequestCount', value: 1, unit: 'Count' },
        ],
        { Provider: 'osrm', Operation: 'geometry', Outcome: 'success' },
      );
      return (body.routes?.[0]?.geometry?.coordinates ?? []).map(([lng, lat]) => [lat, lng]);
    } catch (error: unknown) {
      emitMetrics(
        [
          {
            name: 'RoutingProviderDuration',
            value: durationMsSince(startedAt),
            unit: 'Milliseconds',
          },
          { name: 'RoutingProviderRequestCount', value: 1, unit: 'Count' },
          { name: 'RoutingProviderErrorCount', value: 1, unit: 'Count' },
        ],
        { Provider: 'osrm', Operation: 'geometry', Outcome: 'error' },
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      );
      throw error;
    }
  }

  private stopBucket(count: number): string {
    if (count <= 5) return '1-5';
    if (count <= 10) return '6-10';
    if (count <= 25) return '11-25';
    return '26+';
  }
}
