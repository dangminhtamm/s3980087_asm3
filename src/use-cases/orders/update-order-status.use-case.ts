import type { OrderEventType } from '../../domain/entities/order-event.js';
import type { Order, UpdateOrderStatusInput } from '../../domain/entities/order.js';
import {
  allowedOrderTransitions,
  canTransitionOrder,
  isExceptionStatus,
} from '../../domain/order-lifecycle.js';
import { AppError } from '../../errors/app-error.js';
import type { ClockPort } from '../../ports/clock.port.js';
import type { OrderRepository } from '../../repositories/order.repository.js';
import type { TrackingTokenService } from '../../services/tracking-token.service.js';

const STATUS_EVENTS: Record<UpdateOrderStatusInput['status'], OrderEventType> = {
  IN_PROGRESS: 'DELIVERY_STARTED',
  ARRIVED: 'DRIVER_ARRIVED',
  DELIVERED: 'DELIVERY_COMPLETED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RESCHEDULED: 'DELIVERY_RESCHEDULED',
  CANCELLED: 'ORDER_CANCELLED',
  RETURNING: 'RETURN_STARTED',
  RETURNED: 'ORDER_RETURNED',
};

type StatusOrderRepository = Pick<OrderRepository, 'getById' | 'proofExists' | 'updateStatus'>;

export class UpdateOrderStatusUseCase {
  public constructor(
    private readonly orders: StatusOrderRepository,
    private readonly trackingTokens: TrackingTokenService,
    private readonly clock: ClockPort,
  ) {}

  public async execute(
    orderId: string,
    input: UpdateOrderStatusInput,
    actorId = 'system',
  ): Promise<Order> {
    const current = await this.orders.getById(orderId);
    this.assertAllowed(current, input);
    if (input.status === 'DELIVERED' && !(await this.orders.proofExists(orderId)))
      throw new AppError(
        409,
        'Upload and register proof of delivery before completing the order',
        'DELIVERY_PROOF_REQUIRED',
      );

    await this.trackingTokens.ensure(orderId);
    const updatedAt = this.clock.now().toISOString();
    const next = this.applyStatus(current, input, actorId, updatedAt);
    await this.orders.updateStatus({
      current,
      next,
      input,
      actorId,
      eventType: STATUS_EVENTS[input.status],
      updatedAt,
    });
    return this.orders.getById(orderId);
  }

  private assertAllowed(order: Order, input: UpdateOrderStatusInput): void {
    if (!canTransitionOrder(order.status, input.status))
      throw new AppError(
        409,
        `Cannot change order status from ${order.status} to ${input.status}`,
        'INVALID_STATUS_TRANSITION',
        { allowedTransitions: allowedOrderTransitions(order.status) },
      );
    if (
      ['IN_PROGRESS', 'ARRIVED', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNING', 'RETURNED'].includes(
        input.status,
      ) &&
      !order.driverId
    )
      throw new AppError(
        409,
        'Assign a driver before advancing this order',
        'ORDER_DRIVER_REQUIRED',
      );
    if (isExceptionStatus(input.status) && !input.reason)
      throw new AppError(
        400,
        `A reason is required when moving an order to ${input.status}`,
        'ORDER_EXCEPTION_REASON_REQUIRED',
      );
  }

  private applyStatus(
    order: Order,
    input: UpdateOrderStatusInput,
    actorId: string,
    updatedAt: string,
  ): Order {
    return {
      ...order,
      status: input.status,
      deliveredAt: input.status === 'DELIVERED' ? updatedAt : order.deliveredAt,
      exception: isExceptionStatus(input.status)
        ? {
            reason: input.reason!,
            notes: input.notes ?? null,
            reportedAt: updatedAt,
            reportedBy: actorId,
          }
        : order.exception,
      startedAt: input.status === 'IN_PROGRESS' ? updatedAt : order.startedAt,
      arrivedAt: input.status === 'ARRIVED' ? updatedAt : order.arrivedAt,
    };
  }
}
