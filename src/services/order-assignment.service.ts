import type { Order } from '../domain/entities/order.js';
import type { OrderService } from './order.service.js';
import type { PushService } from './push.service.js';

export class OrderAssignmentService {
  public constructor(
    private readonly orders: OrderService,
    private readonly push: PushService,
  ) {}

  public async assign(orderId: string, driverId: string, actorId: string): Promise<Order> {
    const order = await this.orders.assignDriver(orderId, driverId, actorId);
    await this.push.notifyDriver(driverId, {
      title: 'New CloudFleet delivery',
      body: `${order.customerName} · ${order.dropoffAddress}`,
      url: `/driver?order=${order.orderId}`,
      tag: `order-${order.orderId}`,
    });
    return order;
  }
}
