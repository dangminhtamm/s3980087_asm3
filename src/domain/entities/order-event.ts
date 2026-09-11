import { randomUUID } from 'node:crypto';
import {
  ORDER_EVENT_TYPES,
  type OrderEventSource,
  type OrderEventType,
} from '../../../packages/contracts/index.js';

export { ORDER_EVENT_TYPES, type OrderEventSource, type OrderEventType };

export interface OrderEvent {
  eventId: string;
  orderId: string;
  type: OrderEventType;
  occurredAt: string;
  actorId: string;
  source: OrderEventSource;
  metadata: Record<string, string>;
}

export const createOrderEvent = (
  input: Omit<OrderEvent, 'eventId' | 'source'> & { eventId?: string },
): OrderEvent => {
  const eventId = input.eventId ?? randomUUID();
  return {
    eventId,
    orderId: input.orderId,
    type: input.type,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    source: 'RECORDED',
    metadata: input.metadata,
  };
};
