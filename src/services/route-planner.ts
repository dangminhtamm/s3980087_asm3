import type { Order } from '../domain/entities/order.js';
import type { RoutePlan, RoutingPoint, RoutingPort } from '../ports/routing.port.js';

export class RoutePlanner {
  public constructor(private readonly routing: RoutingPort) {}

  public plan(
    origin: RoutingPoint,
    orders: Order[],
    departureAt: string,
    manualOrderIds?: string[],
  ): Promise<RoutePlan> {
    return this.routing.plan(origin, orders, departureAt, manualOrderIds);
  }
}
