import type { Order } from '../domain/entities/order.js';

export interface RoutingPoint { lat: number; lng: number }
export interface RoutePlanStop {
  orderId: string;
  sequence: number;
  plannedArrivalAt: string;
  plannedDepartureAt: string;
  plannedTravelDurationSeconds: number;
  plannedDistanceMeters: number;
}
export interface RoutePlan {
  stops: RoutePlanStop[];
  plannedDistanceMeters: number;
  plannedDurationSeconds: number;
  geometry: Array<[number, number]>;
  provider: string;
}

interface Matrix { durations: number[][]; distances: number[][]; provider: string }

const haversineMeters = (left: RoutingPoint, right: RoutingPoint): number => {
  const radius = 6_371_000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat = radians(right.lat - left.lat);
  const lng = radians(right.lng - left.lng);
  const value = Math.sin(lat / 2) ** 2 + Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(lng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
};

const fallbackMatrix = (points: RoutingPoint[]): Matrix => {
  const distances = points.map((origin) => points.map((destination) => Math.round(haversineMeters(origin, destination) * 1.25)));
  return {
    distances,
    durations: distances.map((row) => row.map((distance) => Math.round(distance / (25_000 / 3600)))),
    provider: 'straight-line-fallback',
  };
};

const scoreOrder = (order: number[], matrix: Matrix, orders: Order[], departureMs: number): number => {
  let cursor = departureMs;
  let previous = 0;
  let score = 0;
  for (const pointIndex of order) {
    const target = orders[pointIndex - 1]!;
    const travel = matrix.durations[previous]?.[pointIndex] ?? Number.MAX_SAFE_INTEGER;
    cursor += travel * 1000;
    const windowStart = target.timeWindowStart ? Date.parse(target.timeWindowStart) : null;
    const windowEnd = target.timeWindowEnd ? Date.parse(target.timeWindowEnd) : null;
    if (windowStart && cursor < windowStart) cursor = windowStart;
    const lateSeconds = windowEnd && cursor > windowEnd ? (cursor - windowEnd) / 1000 : 0;
    score += travel + lateSeconds * 20;
    cursor += target.serviceDurationMinutes * 60_000;
    previous = pointIndex;
  }
  return score;
};

export const optimizeSequence = (matrix: Matrix, orders: Order[], departureAt: string): number[] => {
  const remaining = new Set(orders.map((_, index) => index + 1));
  const sequence: number[] = [];
  let previous = 0;
  let cursor = Date.parse(departureAt);
  while (remaining.size) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      const order = orders[candidate - 1]!;
      const travel = matrix.durations[previous]?.[candidate] ?? Number.MAX_SAFE_INTEGER;
      const arrival = cursor + travel * 1000;
      const late = order.timeWindowEnd ? Math.max(0, arrival - Date.parse(order.timeWindowEnd)) / 1000 : 0;
      const wait = order.timeWindowStart ? Math.max(0, Date.parse(order.timeWindowStart) - arrival) / 1000 : 0;
      const candidateScore = travel + late * 20 + wait * 0.05;
      if (candidateScore < bestScore) { best = candidate; bestScore = candidateScore; }
    }
    sequence.push(best); remaining.delete(best);
    const selected = orders[best - 1]!;
    cursor += (matrix.durations[previous]?.[best] ?? 0) * 1000;
    if (selected.timeWindowStart) cursor = Math.max(cursor, Date.parse(selected.timeWindowStart));
    cursor += selected.serviceDurationMinutes * 60_000;
    previous = best;
  }

  let best = sequence;
  let bestScore = scoreOrder(best, matrix, orders, Date.parse(departureAt));
  for (let pass = 0; pass < 3; pass += 1) {
    let improved = false;
    for (let left = 0; left < best.length - 1; left += 1) for (let right = left + 1; right < best.length; right += 1) {
      const candidate = [...best.slice(0, left), ...best.slice(left, right + 1).reverse(), ...best.slice(right + 1)];
      const candidateScore = scoreOrder(candidate, matrix, orders, Date.parse(departureAt));
      if (candidateScore < bestScore) { best = candidate; bestScore = candidateScore; improved = true; }
    }
    if (!improved) break;
  }
  return best;
};

export class RoutingService {
  public constructor(
    private readonly provider = process.env.ROUTING_PROVIDER?.trim() || 'straight-line',
    private readonly baseUrl = process.env.ROUTING_BASE_URL?.trim() || 'https://router.project-osrm.org',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async plan(origin: RoutingPoint, orders: Order[], departureAt: string, manualOrderIds?: string[]): Promise<RoutePlan> {
    const points = [origin, ...orders.map(({ lat, lng }) => ({ lat, lng }))];
    const matrix = await this.getMatrix(points);
    const sequence = manualOrderIds
      ? manualOrderIds.map((id) => orders.findIndex((order) => order.orderId === id) + 1)
      : optimizeSequence(matrix, orders, departureAt);
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
      return { orderId: order.orderId, sequence: index + 1, plannedArrivalAt: arrival, plannedDepartureAt: departure, plannedTravelDurationSeconds: travelDuration, plannedDistanceMeters: travelDistance };
    });
    const orderedPoints = [origin, ...sequence.map((index) => points[index]!)];
    const geometry = matrix.provider === 'osrm' ? await this.getGeometry(orderedPoints).catch(() => orderedPoints.map(({ lat, lng }) => [lat, lng] as [number, number])) : orderedPoints.map(({ lat, lng }) => [lat, lng] as [number, number]);
    return { stops, plannedDistanceMeters: distance, plannedDurationSeconds: duration, geometry, provider: matrix.provider };
  }

  private async getMatrix(points: RoutingPoint[]): Promise<Matrix> {
    if (this.provider !== 'osrm') return fallbackMatrix(points);
    try {
      const coordinates = points.map(({ lat, lng }) => `${lng},${lat}`).join(';');
      const response = await this.fetcher(`${this.baseUrl}/table/v1/driving/${coordinates}?annotations=duration,distance`, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error('OSRM matrix failed');
      const body = await response.json() as { code: string; durations: Array<Array<number | null>>; distances: Array<Array<number | null>> };
      if (body.code !== 'Ok') throw new Error('OSRM matrix rejected coordinates');
      return {
        durations: body.durations.map((row) => row.map((value) => value ?? Number.MAX_SAFE_INTEGER)),
        distances: body.distances.map((row) => row.map((value) => value ?? Number.MAX_SAFE_INTEGER)),
        provider: 'osrm',
      };
    } catch { return fallbackMatrix(points); }
  }

  private async getGeometry(points: RoutingPoint[]): Promise<Array<[number, number]>> {
    const coordinates = points.map(({ lat, lng }) => `${lng},${lat}`).join(';');
    const response = await this.fetcher(`${this.baseUrl}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error('OSRM route failed');
    const body = await response.json() as { routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }> };
    return (body.routes?.[0]?.geometry?.coordinates ?? []).map(([lng, lat]) => [lat, lng]);
  }
}
