import type { Order } from '../domain/entities/order.js';
import type { RouteComparison, RouteStatus, RouteStop } from '../domain/entities/route.js';
import type { ClockPort } from '../ports/clock.port.js';
import type { RoutePlanStop } from '../ports/routing.port.js';
import type { StoredRouteStop } from '../infrastructure/dynamodb/mappers/route.mapper.js';

const TERMINAL_STATUSES = new Set(['DELIVERED', 'CANCELLED', 'RETURNED']);
const ACTIVE_STATUSES = new Set(['IN_PROGRESS', 'ARRIVED', 'RETURNING']);

export class RouteComparisonService {
  public constructor(private readonly clock: ClockPort) {}

  public status(stored: RouteStatus, stops: RouteStop[]): RouteStatus {
    if (stops.length > 0 && stops.every((stop) => TERMINAL_STATUSES.has(stop.status)))
      return 'COMPLETED';
    if (stops.some((stop) => ACTIVE_STATUSES.has(stop.status))) return 'IN_PROGRESS';
    return stored;
  }

  public stop(routeId: string, order: Order, plan: RoutePlanStop | StoredRouteStop): RouteStop {
    const plannedArrivalAt = this.validDate(plan.plannedArrivalAt)
      ? plan.plannedArrivalAt
      : (order.plannedArrivalAt ?? order.createdAt);
    const plannedDepartureAt = this.validDate(plan.plannedDepartureAt)
      ? plan.plannedDepartureAt
      : new Date(
          Date.parse(plannedArrivalAt) + order.serviceDurationMinutes * 60_000,
        ).toISOString();
    const actualArrivalAt = order.arrivedAt;
    const now = this.clock.now().getTime();
    const reference = actualArrivalAt
      ? Date.parse(actualArrivalAt)
      : now > Date.parse(plannedArrivalAt)
        ? now
        : Date.parse(plannedArrivalAt);
    return {
      routeId,
      orderId: order.orderId,
      sequence: plan.sequence,
      status: order.status,
      dropoffAddress: order.dropoffAddress,
      lat: order.lat,
      lng: order.lng,
      timeWindowStart: order.timeWindowStart,
      timeWindowEnd: order.timeWindowEnd,
      packageWeightKg: order.packageWeightKg,
      packageVolumeM3: order.packageVolumeM3,
      serviceDurationMinutes: order.serviceDurationMinutes,
      plannedArrivalAt,
      plannedDepartureAt,
      plannedTravelDurationSeconds: plan.plannedTravelDurationSeconds,
      plannedDistanceMeters: plan.plannedDistanceMeters,
      actualArrivalAt,
      etaAt: actualArrivalAt ?? plannedArrivalAt,
      delayMinutes: Math.round((reference - Date.parse(plannedArrivalAt)) / 60_000),
      slaStatus: this.slaStatus(order.timeWindowEnd, plannedArrivalAt, actualArrivalAt, now),
    };
  }

  public empty(plannedDurationSeconds: number): RouteComparison {
    return {
      plannedDurationSeconds,
      actualDurationSeconds: null,
      varianceSeconds: null,
      completedStops: 0,
      onTimeStops: 0,
      lateStops: 0,
    };
  }

  public compare(
    plannedDurationSeconds: number,
    orders: Order[],
    stops: RouteStop[],
  ): RouteComparison {
    const starts = orders
      .map((order) => order.startedAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    const ends = orders
      .map((order) => order.arrivedAt ?? order.deliveredAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    const finalEnd = ends.at(-1);
    const end =
      orders.every((order) => TERMINAL_STATUSES.has(order.status)) && finalEnd
        ? Date.parse(finalEnd)
        : this.clock.now().getTime();
    const actualDurationSeconds = starts[0]
      ? Math.round((end - Date.parse(starts[0])) / 1000)
      : null;
    return {
      plannedDurationSeconds,
      actualDurationSeconds,
      varianceSeconds:
        actualDurationSeconds === null ? null : actualDurationSeconds - plannedDurationSeconds,
      completedStops: orders.filter((order) => TERMINAL_STATUSES.has(order.status)).length,
      onTimeStops: stops.filter((stop) => stop.actualArrivalAt && stop.slaStatus === 'ON_TIME')
        .length,
      lateStops: stops.filter((stop) => stop.slaStatus === 'LATE').length,
    };
  }

  private validDate(value: string | undefined): value is string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }

  private slaStatus(
    timeWindowEnd: string | null,
    plannedArrivalAt: string,
    actualArrivalAt: string | null,
    now: number,
  ): RouteStop['slaStatus'] {
    if (!timeWindowEnd) return 'NO_WINDOW';
    const windowEnd = Date.parse(timeWindowEnd);
    if (actualArrivalAt) return Date.parse(actualArrivalAt) <= windowEnd ? 'ON_TIME' : 'LATE';
    if (now > windowEnd) return 'LATE';
    return Date.parse(plannedArrivalAt) > windowEnd ? 'AT_RISK' : 'ON_TIME';
  }
}
