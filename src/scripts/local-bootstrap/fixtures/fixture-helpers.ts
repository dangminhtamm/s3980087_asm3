import { PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import { DynamoKeys } from '../../../infrastructure/dynamodb/dynamo-keys.js';
import type { LocalBootstrapContext } from '../config.js';
import { isNamedError } from '../resource-setup.js';

export const putOnce = async (
  context: LocalBootstrapContext,
  item: Record<string, unknown>,
): Promise<void> => {
  try {
    await context.documentClient.send(
      new PutCommand({
        TableName: context.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      }),
    );
  } catch (error: unknown) {
    if (!isNamedError(error, ['ConditionalCheckFailedException'])) throw error;
  }
};

export const addMinutes = (value: string, minutes: number): string =>
  new Date(new Date(value).getTime() + minutes * 60_000).toISOString();

export const seedEvent = (
  orderId: string,
  type: string,
  occurredAt: string,
  actorId: string,
  metadata: Record<string, string> = {},
): Record<string, unknown> => {
  const eventId = `seed-${type.toLowerCase()}`;
  return {
    PK: DynamoKeys.orderPk(orderId),
    SK: DynamoKeys.orderEventSk(occurredAt, eventId),
    eventId,
    orderId,
    type,
    occurredAt,
    actorId,
    source: 'RECORDED',
    metadata,
  };
};

export const ensureActiveOrderLock = async (
  context: LocalBootstrapContext,
  orderId: string,
  driverId: string,
): Promise<void> => {
  try {
    await context.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: context.tableName,
              Key: DynamoKeys.orderMetadata(orderId),
              ConditionExpression: '#status = :inProgress',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':inProgress': 'IN_PROGRESS' },
            },
          },
          {
            Update: {
              TableName: context.tableName,
              Key: DynamoKeys.driverProfile(driverId),
              UpdateExpression: 'SET activeOrderId = if_not_exists(activeOrderId, :orderId)',
              ConditionExpression:
                'attribute_exists(PK) AND (attribute_not_exists(activeOrderId) OR activeOrderId = :orderId)',
              ExpressionAttributeValues: { ':orderId': orderId },
            },
          },
        ],
      }),
    );
  } catch (error: unknown) {
    if (!isNamedError(error, ['TransactionCanceledException'])) throw error;
  }
};
