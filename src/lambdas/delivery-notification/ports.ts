import type { OrderStatus } from '../../../packages/contracts/index.js';

export interface DeliveryStatusChange {
  eventId: string;
  sequenceNumber?: string | undefined;
  orderId: string;
  customerPhone?: string | undefined;
  previousStatus?: string | undefined;
  status?: string | undefined;
  occurredAt: string;
}

export interface SmsPort {
  send(customerPhone: string, message: string): Promise<string>;
}

export interface TrackingLinkPort {
  getForOrder(orderId: string): Promise<string | null>;
}

export interface NotificationEventPort {
  record(
    change: DeliveryStatusChange,
    type: 'SMS_NOTIFICATION_SENT' | 'SMS_NOTIFICATION_FAILED',
    metadata: Record<string, string>,
  ): Promise<void>;
}

export interface NotificationLogger {
  info(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
}

export type NotifiableOrderStatus = Extract<
  OrderStatus,
  'IN_PROGRESS' | 'ARRIVED' | 'DELIVERED' | 'DELIVERY_FAILED' | 'RESCHEDULED'
>;
