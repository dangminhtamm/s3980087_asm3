import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { instrumentAwsClient } from '../../observability/metrics.js';
import { DynamoNotificationAdapter } from './adapters/dynamodb.adapter.js';
import { SecretsManagerTwilioConfiguration } from './adapters/secrets-manager.adapter.js';
import { TwilioSmsAdapter } from './adapters/twilio.adapter.js';
import { DeliveryNotificationService } from './delivery-notification.service.js';

const database = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
instrumentAwsClient(database.middlewareStack, 'DynamoDB');
const persistence = new DynamoNotificationAdapter(
  database,
  process.env.DYNAMODB_TABLE_NAME?.trim(),
  process.env.TRACKING_BASE_URL?.trim(),
);
const service = new DeliveryNotificationService(
  new TwilioSmsAdapter(
    new SecretsManagerTwilioConfiguration(new SecretsManagerClient({}), process.env),
  ),
  persistence,
  persistence,
  console,
);

export const handler = async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
  for (const record of event.Records) {
    const change = persistence.fromRecord(record);
    if (!change) continue;
    try {
      await service.process(change);
    } catch (error: unknown) {
      try {
        await persistence.record(change, 'SMS_NOTIFICATION_FAILED', {
          provider: 'Twilio',
          reason: error instanceof Error ? error.message.slice(0, 240) : 'Unknown provider error',
        });
      } catch (eventError: unknown) {
        console.error('Failed to persist SMS notification status', {
          eventId: change.eventId,
          error: eventError instanceof Error ? eventError.message : 'Unknown error',
        });
      }
      console.error('Failed to process DynamoDB Stream record', {
        eventId: change.eventId,
        sequenceNumber: change.sequenceNumber,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      if (change.sequenceNumber) {
        return { batchItemFailures: [{ itemIdentifier: change.sequenceNumber }] };
      }
    }
  }
  return { batchItemFailures: [] };
};
