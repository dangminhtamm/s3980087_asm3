import type { OrderEvent } from '../../../domain/entities/order-event.js';
import { DynamoKeys } from '../dynamo-keys.js';

export interface OrderEventItem extends OrderEvent {
  PK: string;
  SK: string;
}

export const mapOrderEventItem = (event: OrderEvent): OrderEventItem => ({
  ...event,
  PK: DynamoKeys.orderPk(event.orderId),
  SK: DynamoKeys.orderEventSk(event.occurredAt, event.eventId),
});
