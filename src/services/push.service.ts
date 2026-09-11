import { createHash } from 'node:crypto';

import { DeleteCommand, PutCommand, QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import webPush from 'web-push';

import type { DriverPushPayload, DriverPushSubscription, DriverPushSubscriptionInput } from '../domain/entities/push.js';
import { durationMsSince, emitMetrics } from '../observability/metrics.js';

const subscriptionId = (endpoint: string): string => createHash('sha256').update(endpoint).digest('hex');

export class PushService {
  private readonly publicKey = this.configuredValue('VAPID_PUBLIC_KEY');
  private readonly privateKey = this.configuredValue('VAPID_PRIVATE_KEY');

  public constructor(private readonly database: DynamoDBDocumentClient, private readonly tableName: string) {
    if (this.publicKey && this.privateKey) {
      webPush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || 'mailto:ops@cloudfleet.local', this.publicKey, this.privateKey);
    }
  }

  public getPublicKey(): string | null { return this.publicKey; }

  private configuredValue(name: string): string | null {
    const value = process.env[name]?.trim();
    return value && value !== 'REPLACE_ME' ? value : null;
  }

  public async subscribe(driverId: string, input: DriverPushSubscriptionInput): Promise<DriverPushSubscription> {
    const now = new Date().toISOString();
    const id = subscriptionId(input.endpoint);
    const item: DriverPushSubscription & { PK: string; SK: string } = {
      PK: `DRIVER#${driverId}`,
      SK: `PUSH#${id}`,
      driverId,
      subscriptionId: id,
      endpoint: input.endpoint,
      expirationTime: input.expirationTime ?? null,
      keys: input.keys,
      createdAt: now,
      updatedAt: now,
    };
    await this.database.send(new PutCommand({ TableName: this.tableName, Item: item }));
    const { PK: _pk, SK: _sk, ...subscription } = item;
    return subscription;
  }

  public async unsubscribe(driverId: string, endpoint: string): Promise<void> {
    await this.database.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { PK: `DRIVER#${driverId}`, SK: `PUSH#${subscriptionId(endpoint)}` },
    }));
  }

  public async notifyDriver(driverId: string, payload: DriverPushPayload): Promise<{ sent: number; configured: boolean }> {
    if (!this.publicKey || !this.privateKey) {
      emitMetrics([{ name: 'PushNotConfiguredCount', value: 1, unit: 'Count' }], { Provider: 'web-push' });
      return { sent: 0, configured: false };
    }
    const result = await this.database.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :driver AND begins_with(SK, :push)',
      ExpressionAttributeValues: { ':driver': `DRIVER#${driverId}`, ':push': 'PUSH#' },
    }));
    let sent = 0;
    await Promise.all((result.Items ?? []).map(async (item) => {
      if (typeof item.endpoint !== 'string' || typeof item.SK !== 'string' || !item.keys) return;
      const startedAt = process.hrtime.bigint();
      try {
        await webPush.sendNotification({ endpoint: item.endpoint, expirationTime: typeof item.expirationTime === 'number' ? item.expirationTime : null, keys: item.keys as { p256dh: string; auth: string } }, JSON.stringify(payload), { TTL: 60 * 60 });
        sent += 1;
        emitMetrics([
          { name: 'PushDeliveryDuration', value: durationMsSince(startedAt), unit: 'Milliseconds' },
          { name: 'PushAttemptCount', value: 1, unit: 'Count' },
          { name: 'PushSuccessCount', value: 1, unit: 'Count' },
        ], { Provider: 'web-push', Outcome: 'success' });
        emitMetrics([{ name: 'PushSuccessRate', value: 100, unit: 'Percent' }], { Provider: 'web-push' });
      } catch (error: unknown) {
        emitMetrics([
          { name: 'PushDeliveryDuration', value: durationMsSince(startedAt), unit: 'Milliseconds' },
          { name: 'PushAttemptCount', value: 1, unit: 'Count' },
          { name: 'PushFailureCount', value: 1, unit: 'Count' },
        ], { Provider: 'web-push', Outcome: 'error' }, {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        emitMetrics([{ name: 'PushSuccessRate', value: 0, unit: 'Percent' }], { Provider: 'web-push' });
        const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error ? (error as { statusCode?: unknown }).statusCode : null;
        if (statusCode === 404 || statusCode === 410) {
          await this.database.send(new DeleteCommand({ TableName: this.tableName, Key: { PK: `DRIVER#${driverId}`, SK: item.SK } }));
          return;
        }
        console.error('Driver push notification failed', { driverId, subscriptionId: item.SK.slice(5), statusCode });
      }
    }));
    return { sent, configured: true };
  }
}
