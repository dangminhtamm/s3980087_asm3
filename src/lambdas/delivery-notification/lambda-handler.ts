import type {
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from 'aws-lambda';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { durationMsSince, emitMetrics, instrumentAwsClient } from '../../observability/metrics.js';

const TWILIO_TIMEOUT_MS = 8_000;
const E164_PHONE_NUMBER = /^\+[1-9]\d{7,14}$/;

const getRequiredEnvironmentVariable = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

interface TwilioConfiguration {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

const secretsManager = new SecretsManagerClient({});
const database = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
instrumentAwsClient(database.middlewareStack, 'DynamoDB');
let configurationPromise: Promise<TwilioConfiguration> | undefined;

const getTwilioConfiguration = async (): Promise<TwilioConfiguration> => {
  const secretArn = process.env.APP_SECRET_ARN?.trim();

  // Local tests can continue to use environment variables. Deployed Lambda
  // reads the provider credentials from Secrets Manager at cold start.
  if (!secretArn) {
    return {
      accountSid: getRequiredEnvironmentVariable('TWILIO_ACCOUNT_SID'),
      authToken: getRequiredEnvironmentVariable('TWILIO_AUTH_TOKEN'),
      fromNumber: getRequiredEnvironmentVariable('TWILIO_FROM_NUMBER'),
    };
  }

  configurationPromise ??= secretsManager
    .send(new GetSecretValueCommand({ SecretId: secretArn }))
    .then((result) => {
      if (!result.SecretString) {
        throw new Error('Application secret does not contain a SecretString');
      }

      const value = JSON.parse(result.SecretString) as Record<string, unknown>;
      const accountSid = value.twilioAccountSid;
      const authToken = value.twilioAuthToken;
      const fromNumber = value.twilioFromNumber;

      if (
        typeof accountSid !== 'string' ||
        typeof authToken !== 'string' ||
        typeof fromNumber !== 'string'
      ) {
        throw new Error('Application secret has invalid Twilio fields');
      }

      return { accountSid, authToken, fromNumber };
    });

  return configurationPromise;
};

const getStringAttribute = (
  image: NonNullable<DynamoDBRecord['dynamodb']>['NewImage'],
  attributeName: string,
): string | undefined => image?.[attributeName]?.S?.trim();

const normalizeStatus = (status: string | undefined): string | undefined =>
  status?.replace(/\s+/g, '_').toUpperCase();

const sendDeliverySms = async (
  customerPhone: string,
  message: string,
): Promise<string> => {
  const configuration = await getTwilioConfiguration();
  const body = new URLSearchParams({
    To: customerPhone,
    From: configuration.fromNumber,
    Body: message,
  });
  const messagesUrl =
    `https://api.twilio.com/2010-04-01/Accounts/` +
    `${encodeURIComponent(configuration.accountSid)}/Messages.json`;
  const authorization = `Basic ${Buffer.from(
    `${configuration.accountSid}:${configuration.authToken}`,
  ).toString('base64')}`;

  const response = await fetch(messagesUrl, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Do not log the response body because it can contain customer information.
    throw new Error(`Twilio returned HTTP ${response.status}`);
  }
  const payload = await response.json() as { sid?: unknown };
  return typeof payload.sid === 'string' ? payload.sid : 'accepted';
};

const getTrackingUrl = async (orderId: string): Promise<string | null> => {
  const tableName = process.env.DYNAMODB_TABLE_NAME?.trim();
  const trackingBaseUrl = process.env.TRACKING_BASE_URL?.trim();
  if (!tableName || !trackingBaseUrl) return null;
  const result = await database.send(new GetCommand({
    TableName: tableName,
    Key: { PK: `ORDER#${orderId}`, SK: 'TRACKING#TOKEN' },
    ConsistentRead: true,
  }));
  const token = result.Item?.trackingToken;
  const expiresAt = result.Item?.expiresAt;
  if (
    typeof token !== 'string' ||
    typeof expiresAt !== 'number' ||
    expiresAt <= Math.floor(Date.now() / 1000)
  ) return null;
  return `${trackingBaseUrl.replace(/\/$/, '')}/track/${encodeURIComponent(token)}`;
};

const writeSmsEvent = async (
  record: DynamoDBRecord,
  type: 'SMS_NOTIFICATION_SENT' | 'SMS_NOTIFICATION_FAILED',
  metadata: Record<string, string>,
): Promise<void> => {
  const tableName = process.env.DYNAMODB_TABLE_NAME?.trim();
  const newImage = record.dynamodb?.NewImage;
  const orderId = getStringAttribute(newImage, 'orderId');
  if (!tableName || !orderId) return;
  const occurredAt = getStringAttribute(newImage, 'deliveredAt') ?? new Date().toISOString();
  const eventId = `sms-${record.eventID}`;
  await database.send(new PutCommand({
    TableName: tableName,
    Item: {
      PK: `ORDER#${orderId}`,
      SK: `EVENT#${occurredAt}#${eventId}`,
      eventId,
      orderId,
      type,
      occurredAt,
      actorId: 'delivery-notification-lambda',
      source: 'RECORDED',
      metadata,
    },
  }));
};

const processRecord = async (record: DynamoDBRecord): Promise<void> => {
  // INSERT/REMOVE records and unrelated MODIFY records require no work.
  if (record.eventName !== 'MODIFY') {
    return;
  }

  const newImage = record.dynamodb?.NewImage;
  const oldImage = record.dynamodb?.OldImage;
  const newStatus = normalizeStatus(getStringAttribute(newImage, 'status'));
  const oldStatus = normalizeStatus(getStringAttribute(oldImage, 'status'));

  // Notify only on meaningful status transitions, never on unrelated updates.
  if (
    !['IN_PROGRESS', 'ARRIVED', 'DELIVERED', 'DELIVERY_FAILED', 'RESCHEDULED'].includes(newStatus ?? '') ||
    newStatus === oldStatus
  ) {
    return;
  }

  const orderId = getStringAttribute(newImage, 'orderId') ?? 'unknown';
  const customerPhone = getStringAttribute(newImage, 'customerPhone');

  // Invalid business data is permanent; retrying it would create a poison record.
  if (!customerPhone || !E164_PHONE_NUMBER.test(customerPhone)) {
    console.error('Skipping delivery SMS: invalid customerPhone', { orderId });
    return;
  }

  const trackingUrl = await getTrackingUrl(orderId);
  const messages: Record<string, string> = {
    IN_PROGRESS: 'Your CloudFleet delivery is on the way.',
    ARRIVED: 'Your CloudFleet driver has arrived at the destination.',
    DELIVERED: 'Your order has been delivered successfully.',
    DELIVERY_FAILED: 'CloudFleet could not complete your delivery. The operations team is reviewing it.',
    RESCHEDULED: 'Your CloudFleet delivery has been rescheduled.',
  };
  const linkLabel = newStatus === 'DELIVERED' ? 'View confirmation' : 'Track or manage delivery';
  const message = `${messages[newStatus!] ?? 'Your CloudFleet delivery was updated.'}${trackingUrl ? ` ${linkLabel}: ${trackingUrl}` : ''}`;
  const smsStartedAt = process.hrtime.bigint();
  emitMetrics([{ name: 'SmsAttemptCount', value: 1, unit: 'Count' }], { Provider: 'Twilio' });
  let messageSid: string;
  try {
    messageSid = await sendDeliverySms(customerPhone, message);
    emitMetrics([
      { name: 'SmsProviderDuration', value: durationMsSince(smsStartedAt), unit: 'Milliseconds' },
      { name: 'SmsSuccessCount', value: 1, unit: 'Count' },
    ], { Provider: 'Twilio', Outcome: 'success' });
    emitMetrics([{ name: 'SmsSuccessRate', value: 100, unit: 'Percent' }], { Provider: 'Twilio' });
  } catch (error: unknown) {
    emitMetrics([
      { name: 'SmsProviderDuration', value: durationMsSince(smsStartedAt), unit: 'Milliseconds' },
      { name: 'SmsFailureCount', value: 1, unit: 'Count' },
    ], { Provider: 'Twilio', Outcome: 'error' }, {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    emitMetrics([{ name: 'SmsSuccessRate', value: 0, unit: 'Percent' }], { Provider: 'Twilio' });
    throw error;
  }
  await writeSmsEvent(record, 'SMS_NOTIFICATION_SENT', {
    provider: 'Twilio',
    messageSid,
    status: newStatus!,
    ...(trackingUrl ? { trackingLinkIncluded: 'true' } : {}),
  });
  console.info('Delivery SMS accepted by Twilio', { orderId, messageSid });
};

/**
 * Processes records in stream order. On a transient Twilio failure, the handler
 * returns the failed sequence number instead of throwing and crashing the batch.
 * Records from that checkpoint can then be retried by the Lambda event source.
 */
export const handler = async (
  event: DynamoDBStreamEvent,
): Promise<DynamoDBBatchResponse> => {
  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error: unknown) {
      const sequenceNumber = record.dynamodb?.SequenceNumber;

      try {
        await writeSmsEvent(record, 'SMS_NOTIFICATION_FAILED', {
          provider: 'Twilio',
          reason: error instanceof Error ? error.message.slice(0, 240) : 'Unknown provider error',
        });
      } catch (eventError: unknown) {
        console.error('Failed to persist SMS notification status', {
          eventId: record.eventID,
          error: eventError instanceof Error ? eventError.message : 'Unknown error',
        });
      }

      console.error('Failed to process DynamoDB Stream record', {
        eventId: record.eventID,
        sequenceNumber,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      if (sequenceNumber) {
        return {
          batchItemFailures: [{ itemIdentifier: sequenceNumber }],
        };
      }

      // A genuine stream record always has a sequence number. If a malformed test
      // event does not, continue so the function still returns a valid response.
    }
  }

  return { batchItemFailures: [] };
};
