import type { Order } from '../domain/entities/order.js';
import type { PushPort } from '../ports/push.port.js';
import type { OrderService } from './order.service.js';

export class OrderAssignmentService {
  public constructor(
    private readonly orders: OrderService,
    private readonly push: PushPort,
  ) {}

  public async assign(orderId: string, driverId: string, actorId: string): Promise<Order> {
    const order = await this.orders.assignDriver(orderId, driverId, actorId);
    void this.push
      .notifyDriver(driverId, {
        title: 'New CloudFleet delivery',
        body: `${order.customerName} · ${order.dropoffAddress}`,
        url: `/driver?order=${order.orderId}`,
        tag: `order-${order.orderId}`,
      })
      .catch((error: unknown) => {
        console.error('Order assignment push dispatch failed', {
          orderId: order.orderId,
          driverId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return order;
  }
}
