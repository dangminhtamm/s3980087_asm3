import { randomUUID } from 'node:crypto';

export const ORDER_EVENT_TYPES = [
  'ORDER_CREATED',
  'DRIVER_ASSIGNED',
  'DELIVERY_STARTED',
  'DRIVER_ARRIVED',
  'PROOF_UPLOADED',
  'DELIVERY_COMPLETED',
  'DELIVERY_FAILED',
  'DELIVERY_RESCHEDULED',
  'ORDER_CANCELLED',
  'RETURN_STARTED',
  'ORDER_RETURNED',
  'SMS_NOTIFICATION_SENT',
  'SMS_NOTIFICATION_FAILED',
  'CUSTOMER_RESCHEDULE_REQUESTED',
  'CUSTOMER_FEEDBACK_RECEIVED',
] as const;

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];
export type OrderEventSource = 'RECORDED' | 'DERIVED';

export interface OrderEvent {
  eventId: string;
  orderId: string;
  type: OrderEventType;
  occurredAt: string;
  actorId: string;
  source: OrderEventSource;
  metadata: Record<string, string>;
}

export interface OrderEventItem extends OrderEvent {
  PK: string;
  SK: string;
}

export const createOrderEventItem = (
  input: Omit<OrderEvent, 'eventId' | 'source'> & { eventId?: string },
): OrderEventItem => {
  const eventId = input.eventId ?? randomUUID();
  return {
    PK: `ORDER#${input.orderId}`,
    SK: `EVENT#${input.occurredAt}#${eventId}`,
    eventId,
    orderId: input.orderId,
    type: input.type,
    occurredAt: input.occurredAt,
    actorId: input.actorId,
    source: 'RECORDED',
    metadata: input.metadata,
  };
};
