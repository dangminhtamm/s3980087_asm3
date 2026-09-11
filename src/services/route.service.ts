import type { Route } from '../domain/entities/route.js';
import { AppError } from '../errors/app-error.js';
import type { ClockPort } from '../ports/clock.port.js';
import type { RouteRepository } from '../repositories/route.repository.js';
import type {
  RouteAssignmentUseCase,
  RouteDriverReader,
  RouteOrderReader,
} from '../use-cases/routes/route-assignment.use-case.js';
import type { RouteComparisonService } from './route-comparison.service.js';
import type { RoutePlanner } from './route-planner.js';
import type { CreateRouteInput } from '../domain/entities/route.js';

export class RouteService {
  public constructor(
    private readonly repository: RouteRepository,
    private readonly assignment: RouteAssignmentUseCase,
    private readonly orders: RouteOrderReader,
    private readonly drivers: RouteDriverReader,
    private readonly planner: RoutePlanner,
    private readonly comparison: RouteComparisonService,
    private readonly clock: ClockPort,
  ) {}

  public createRoute(input: CreateRouteInput, actorId: string): Promise<Route> {
    return this.assignment.execute(input, actorId);
  }

  public async getRoute(routeId: string): Promise<Route> {
    const stored = await this.repository.load(routeId);
    const liveOrders = await Promise.all(
      stored.stops.map((stop) => this.orders.getOrder(stop.orderId)),
    );
    const byOrder = new Map(stored.stops.map((stop) => [stop.orderId, stop]));
    const stops = liveOrders
      .map((order) => this.comparison.stop(routeId, order, byOrder.get(order.orderId)!))
      .sort((left, right) => left.sequence - right.sequence);
    return {
      ...stored.route,
      status: this.comparison.status(stored.route.status, stops),
      comparison: this.comparison.compare(stored.route.plannedDurationSeconds, liveOrders, stops),
      stops,
    };
  }

  public async listRoutes(driverId: string | undefined, limit: number): Promise<Route[]> {
    const routes = await this.repository.list(driverId, limit);
    return routes.map((route) => ({
      ...route,
      comparison: this.comparison.empty(route.plannedDurationSeconds),
      stops: [],
    }));
  }

  public reorder(routeId: string, orderIds: string[], actorId: string): Promise<Route> {
    return this.updatePlan(routeId, orderIds, actorId);
  }

  public reoptimize(
    routeId: string,
    departureAt: string | undefined,
    actorId: string,
  ): Promise<Route> {
    return this.updatePlan(routeId, undefined, actorId, departureAt);
  }

  private async updatePlan(
    routeId: string,
    manualOrderIds: string[] | undefined,
    actorId: string,
    departureOverride?: string,
  ): Promise<Route> {
    const stored = await this.repository.load(routeId);
    if (stored.route.status !== 'PLANNED')
      throw new AppError(409, 'Only a planned route can be reordered', 'ROUTE_REORDER_NOT_ALLOWED');
    const orders = await Promise.all(
      stored.stops.map((stop) => this.orders.getOrder(stop.orderId)),
    );
    if (manualOrderIds)
      this.assertSameStops(
        manualOrderIds,
        orders.map(({ orderId }) => orderId),
      );
    const driver = await this.drivers.getDriver(stored.route.driverId);
    const origin =
      driver.lat !== null && driver.lng !== null
        ? { lat: driver.lat, lng: driver.lng }
        : stored.route.origin;
    const optimizedAt = this.clock.now().toISOString();
    const plan = await this.planner.plan(
      origin,
      orders,
      departureOverride ?? optimizedAt,
      manualOrderIds,
    );
    await this.repository.updatePlan({
      route: stored.route,
      stops: stored.stops,
      plan,
      origin,
      manual: Boolean(manualOrderIds),
      actorId,
      optimizedAt,
    });
    return this.getRoute(routeId);
  }

  private assertSameStops(requested: string[], current: string[]): void {
    if (
      requested.length !== current.length ||
      new Set(requested).size !== current.length ||
      requested.some((id) => !current.includes(id))
    )
      throw new AppError(
        400,
        'orderIds must contain every route stop exactly once',
        'ROUTE_STOP_SET_MISMATCH',
      );
  }
}
