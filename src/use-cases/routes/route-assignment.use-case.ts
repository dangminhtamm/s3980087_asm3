import type { Driver } from '../../domain/entities/driver.js';
import type { Order } from '../../domain/entities/order.js';
import type { CreateRouteInput, Route } from '../../domain/entities/route.js';
import type { VehicleCapacityPolicy } from '../../domain/policies/vehicle-capacity.policy.js';
import { AppError } from '../../errors/app-error.js';
import type { ClockPort } from '../../ports/clock.port.js';
import type { IdGeneratorPort } from '../../ports/id-generator.port.js';
import type { RoutingPoint } from '../../ports/routing.port.js';
import type { RouteRepository } from '../../repositories/route.repository.js';
import type { RouteComparisonService } from '../../services/route-comparison.service.js';
import type { RoutePlanner } from '../../services/route-planner.js';

export interface RouteOrderReader {
  getOrder(orderId: string): Promise<Order>;
  listOrders(input: { driverId: string; limit: number }): Promise<Order[]>;
}

export interface RouteDriverReader {
  getDriver(driverId: string): Promise<Driver>;
}

export class RouteAssignmentUseCase {
  public constructor(
    private readonly routes: Pick<RouteRepository, 'create'>,
    private readonly orders: RouteOrderReader,
    private readonly drivers: RouteDriverReader,
    private readonly planner: RoutePlanner,
    private readonly comparison: RouteComparisonService,
    private readonly capacity: VehicleCapacityPolicy,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
    private readonly defaultOrigin: RoutingPoint,
  ) {}

  public async execute(input: CreateRouteInput, actorId: string): Promise<Route> {
    const [driver, selected, current] = await Promise.all([
      this.drivers.getDriver(input.driverId),
      Promise.all(input.orderIds.map((orderId) => this.orders.getOrder(orderId))),
      this.orders.listOrders({ driverId: input.driverId, limit: 100 }),
    ]);
    if (driver.status === 'OFFLINE')
      throw new AppError(409, 'An offline driver cannot receive a route', 'DRIVER_OFFLINE');
    const unavailable = selected.find(
      (order) => !['PENDING', 'RESCHEDULED'].includes(order.status) || order.driverId,
    );
    if (unavailable)
      throw new AppError(
        409,
        `Order ${unavailable.orderId} is no longer available`,
        'ROUTE_ORDER_UNAVAILABLE',
      );

    this.capacity.assertFits(driver, current, selected, 'route');
    const origin = {
      lat: driver.lat ?? this.defaultOrigin.lat,
      lng: driver.lng ?? this.defaultOrigin.lng,
    };
    const plan = await this.planner.plan(
      origin,
      selected,
      `${input.scheduledDate}T01:00:00.000Z`,
      input.optimize === false ? input.orderIds : undefined,
    );
    const route = this.buildRoute(input, actorId, origin, selected, plan);
    await this.routes.create(route, selected);
    return route;
  }

  private buildRoute(
    input: CreateRouteInput,
    actorId: string,
    origin: RoutingPoint,
    orders: Order[],
    plan: Awaited<ReturnType<RoutePlanner['plan']>>,
  ): Route {
    const createdAt = this.clock.now().toISOString();
    const routeId = this.ids.next();
    const byOrder = new Map(plan.stops.map((stop) => [stop.orderId, stop]));
    return {
      routeId,
      driverId: input.driverId,
      scheduledDate: input.scheduledDate,
      status: 'PLANNED',
      stopCount: orders.length,
      totalWeightKg: orders.reduce((sum, order) => sum + order.packageWeightKg, 0),
      totalVolumeM3: orders.reduce((sum, order) => sum + order.packageVolumeM3, 0),
      createdAt,
      createdBy: actorId,
      origin,
      plannedDistanceMeters: plan.plannedDistanceMeters,
      plannedDurationSeconds: plan.plannedDurationSeconds,
      geometry: plan.geometry,
      optimization: {
        provider: plan.provider,
        mode: input.optimize === false ? 'MANUAL' : 'AUTO',
        optimizedAt: createdAt,
        revision: 1,
      },
      comparison: this.comparison.empty(plan.plannedDurationSeconds),
      stops: orders
        .map((order) => this.comparison.stop(routeId, order, byOrder.get(order.orderId)!))
        .sort((left, right) => left.sequence - right.sequence),
    };
  }
}
