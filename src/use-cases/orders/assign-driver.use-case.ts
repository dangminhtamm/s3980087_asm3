import type { Order } from '../../domain/entities/order.js';
import { canTransitionOrder } from '../../domain/order-lifecycle.js';
import type { VehicleCapacityPolicy } from '../../domain/policies/vehicle-capacity.policy.js';
import { AppError } from '../../errors/app-error.js';
import type { ClockPort } from '../../ports/clock.port.js';
import type { OrderRepository } from '../../repositories/order.repository.js';

type AssignmentOrderRepository = Pick<
  OrderRepository,
  'getById' | 'getDriverCapacity' | 'list' | 'assign'
>;

export class AssignDriverUseCase {
  public constructor(
    private readonly orders: AssignmentOrderRepository,
    private readonly capacity: VehicleCapacityPolicy,
    private readonly clock: ClockPort,
  ) {}

  public async execute(orderId: string, driverId: string, actorId = 'system'): Promise<Order> {
    const order = await this.orders.getById(orderId);
    if (!canTransitionOrder(order.status, 'ASSIGNED'))
      throw new AppError(
        409,
        'Only pending or rescheduled orders can be assigned',
        'ORDER_ASSIGNMENT_NOT_ALLOWED',
      );

    const [vehicle, current] = await Promise.all([
      this.orders.getDriverCapacity(driverId),
      this.orders.list({ driverId, limit: 100 }),
    ]);
    this.capacity.assertFits(vehicle, current, [order]);
    await this.orders.assign(order, driverId, actorId, this.clock.now().toISOString());
    return this.orders.getById(orderId);
  }
}
