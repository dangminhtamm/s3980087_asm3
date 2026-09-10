import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { ORDER_EVENT_TYPES, type OrderEvent, type OrderEventType } from '../domain/entities/order-event.js';
import type { Order } from '../domain/entities/order.js';

const isEventType = (value: unknown): value is OrderEventType =>
  typeof value === 'string' && ORDER_EVENT_TYPES.some((type) => type === value);

export class OrderEventService {
  public constructor(private readonly database: DynamoDBDocumentClient, private readonly tableName: string) {}

  public async list(order: Order): Promise<OrderEvent[]> {
    const result = await this.database.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :event)',
      ExpressionAttributeValues: { ':pk': `ORDER#${order.orderId}`, ':event': 'EVENT#' },
      ScanIndexForward: true,
    }));
    const recorded = (result.Items ?? []).map((item) => this.toEvent(item));
    return this.withLegacyEvents(order, recorded).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }

  /** Keeps pre-event seed/production orders useful while clearly marking inferred entries. */
  private withLegacyEvents(order: Order, recorded: OrderEvent[]): OrderEvent[] {
    const events = [...recorded];
    const add = (type: OrderEventType, occurredAt: string, metadata: Record<string, string> = {}) => {
      if (events.some((event) => event.type === type)) return;
      events.push({ eventId: `derived-${type.toLowerCase()}`, orderId: order.orderId, type, occurredAt, actorId: 'legacy-snapshot', source: 'DERIVED', metadata });
    };
    add('ORDER_CREATED', order.createdAt);
    if (order.driverId) add('DRIVER_ASSIGNED', order.createdAt, { driverId: order.driverId });
    if (['IN_PROGRESS', 'ARRIVED', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNING', 'RETURNED'].includes(order.status)) {
      add('DELIVERY_STARTED', order.createdAt);
    }
    if (['ARRIVED', 'DELIVERED'].includes(order.status)) add('DRIVER_ARRIVED', order.createdAt);
    if (['DELIVERY_FAILED', 'RESCHEDULED', 'RETURNING', 'RETURNED'].includes(order.status) && order.exception) {
      add('DELIVERY_FAILED', order.exception.reportedAt, { reason: order.exception.reason });
    }
    if (order.status === 'RESCHEDULED' && order.exception) add('DELIVERY_RESCHEDULED', order.exception.reportedAt);
    if (order.status === 'CANCELLED' && order.exception) add('ORDER_CANCELLED', order.exception.reportedAt, { reason: order.exception.reason });
    if (['RETURNING', 'RETURNED'].includes(order.status) && order.exception) add('RETURN_STARTED', order.exception.reportedAt);
    if (order.status === 'RETURNED' && order.exception) add('ORDER_RETURNED', order.exception.reportedAt);
    if (order.status === 'DELIVERED' && order.deliveredAt) {
      add('PROOF_UPLOADED', order.deliveredAt);
      add('DELIVERY_COMPLETED', order.deliveredAt);
    }
    return events;
  }

  private toEvent(item: Record<string, unknown>): OrderEvent {
    if (typeof item.eventId !== 'string' || typeof item.orderId !== 'string' || !isEventType(item.type) || typeof item.occurredAt !== 'string' || typeof item.actorId !== 'string') throw new Error('Stored order event is invalid');
    const metadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
      ? Object.fromEntries(Object.entries(item.metadata).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {};
    return { eventId: item.eventId, orderId: item.orderId, type: item.type, occurredAt: item.occurredAt, actorId: item.actorId, source: item.source === 'DERIVED' ? 'DERIVED' : 'RECORDED', metadata };
  }
}
