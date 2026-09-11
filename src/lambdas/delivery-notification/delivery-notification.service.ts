import type {
  DeliveryStatusChange,
  NotificationEventPort,
  NotificationLogger,
  NotifiableOrderStatus,
  SmsPort,
  TrackingLinkPort,
} from './ports.js';

const E164_PHONE_NUMBER = /^\+[1-9]\d{7,14}$/;
const messages: Record<NotifiableOrderStatus, string> = {
  IN_PROGRESS: 'Your CloudFleet delivery is on the way.',
  ARRIVED: 'Your CloudFleet driver has arrived at the destination.',
  DELIVERED: 'Your order has been delivered successfully.',
  DELIVERY_FAILED:
    'CloudFleet could not complete your delivery. The operations team is reviewing it.',
  RESCHEDULED: 'Your CloudFleet delivery has been rescheduled.',
};

const normalizeStatus = (status: string | undefined): string | undefined =>
  status?.replace(/\s+/g, '_').toUpperCase();

const isNotifiable = (status: string | undefined): status is NotifiableOrderStatus =>
  Boolean(status && Object.hasOwn(messages, status));

export class DeliveryNotificationService {
  constructor(
    private readonly sms: SmsPort,
    private readonly trackingLinks: TrackingLinkPort,
    private readonly events: NotificationEventPort,
    private readonly logger: NotificationLogger,
  ) {}

  async process(change: DeliveryStatusChange): Promise<void> {
    const status = normalizeStatus(change.status);
    const previousStatus = normalizeStatus(change.previousStatus);
    if (!isNotifiable(status) || status === previousStatus) return;

    if (!change.customerPhone || !E164_PHONE_NUMBER.test(change.customerPhone)) {
      this.logger.error('Skipping delivery SMS: invalid customerPhone', {
        orderId: change.orderId,
      });
      return;
    }

    const trackingUrl = await this.trackingLinks.getForOrder(change.orderId);
    const linkLabel = status === 'DELIVERED' ? 'View confirmation' : 'Track or manage delivery';
    const message = `${messages[status]}${trackingUrl ? ` ${linkLabel}: ${trackingUrl}` : ''}`;
    const messageSid = await this.sms.send(change.customerPhone, message);
    await this.events.record(change, 'SMS_NOTIFICATION_SENT', {
      provider: 'Twilio',
      messageSid,
      status,
      ...(trackingUrl ? { trackingLinkIncluded: 'true' } : {}),
    });
    this.logger.info('Delivery SMS accepted by Twilio', { orderId: change.orderId, messageSid });
  }
}
