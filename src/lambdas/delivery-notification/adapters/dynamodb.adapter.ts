import type { DynamoDBRecord } from 'aws-lambda';
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoKeys } from '../../../infrastructure/dynamodb/dynamo-keys.js';
import type { DeliveryStatusChange, NotificationEventPort, TrackingLinkPort } from '../ports.js';

const stringAttribute = (
  image: NonNullable<DynamoDBRecord['dynamodb']>['NewImage'],
  name: string,
): string | undefined => image?.[name]?.S?.trim();

export class DynamoNotificationAdapter implements TrackingLinkPort, NotificationEventPort {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string | undefined,
    private readonly trackingBaseUrl: string | undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  fromRecord(record: DynamoDBRecord): DeliveryStatusChange | null {
    if (record.eventName !== 'MODIFY') return null;
    const newImage = record.dynamodb?.NewImage;
    const oldImage = record.dynamodb?.OldImage;
    return {
      eventId: record.eventID ?? 'unknown-event',
      sequenceNumber: record.dynamodb?.SequenceNumber,
      orderId: stringAttribute(newImage, 'orderId') ?? 'unknown',
      customerPhone: stringAttribute(newImage, 'customerPhone'),
      status: stringAttribute(newImage, 'status'),
      previousStatus: stringAttribute(oldImage, 'status'),
      occurredAt: stringAttribute(newImage, 'deliveredAt') ?? this.now().toISOString(),
    };
  }

  async getForOrder(orderId: string): Promise<string | null> {
    if (!this.tableName || !this.trackingBaseUrl) return null;
    const result = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: DynamoKeys.orderTrackingToken(orderId),
        ConsistentRead: true,
      }),
    );
    const token = result.Item?.trackingToken;
    const expiresAt = result.Item?.expiresAt;
    if (
      typeof token !== 'string' ||
      typeof expiresAt !== 'number' ||
      expiresAt <= Math.floor(this.now().getTime() / 1000)
    ) {
      return null;
    }
    return `${this.trackingBaseUrl.replace(/\/$/, '')}/track/${encodeURIComponent(token)}`;
  }

  async record(
    change: DeliveryStatusChange,
    type: 'SMS_NOTIFICATION_SENT' | 'SMS_NOTIFICATION_FAILED',
    metadata: Record<string, string>,
  ): Promise<void> {
    if (!this.tableName || change.orderId === 'unknown') return;
    const eventId = `sms-${change.eventId}`;
    await this.database.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: DynamoKeys.orderPk(change.orderId),
          SK: DynamoKeys.orderEventSk(change.occurredAt, eventId),
          eventId,
          orderId: change.orderId,
          type,
          occurredAt: change.occurredAt,
          actorId: 'delivery-notification-lambda',
          source: 'RECORDED',
          metadata,
        },
      }),
    );
  }
}
