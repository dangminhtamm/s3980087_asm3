import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoKeys } from '../../infrastructure/dynamodb/dynamo-keys.js';
import type { LocalBootstrapContext } from './config.js';

const migrateLegacyAssignedOrders = async (context: LocalBootstrapContext): Promise<void> => {
  const result = await context.documentClient.send(
    new QueryCommand({
      TableName: context.tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pending',
      ExpressionAttributeValues: { ':pending': 'ORDER_STATUS#PENDING' },
    }),
  );
  const legacyAssigned = (result.Items ?? []).filter(
    (item) => typeof item.orderId === 'string' && typeof item.driverId === 'string',
  );
  await Promise.all(
    legacyAssigned.map((item) =>
      context.documentClient.send(
        new UpdateCommand({
          TableName: context.tableName,
          Key: DynamoKeys.orderMetadata(item.orderId as string),
          UpdateExpression: 'SET #status = :assigned, GSI1SK = :gsi1sk, GSI2PK = :gsi2pk',
          ConditionExpression: '#status = :pending AND attribute_exists(driverId)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':assigned': 'ASSIGNED',
            ':pending': 'PENDING',
            ':gsi1sk': DynamoKeys.driverOrderSk({
              status: 'ASSIGNED',
              createdAt: item.createdAt as string,
              orderId: item.orderId as string,
            }),
            ':gsi2pk': 'ORDER_STATUS#ASSIGNED',
          },
        }),
      ),
    ),
  );
  if (legacyAssigned.length > 0) {
    console.info(`Migrated ${legacyAssigned.length} legacy assigned orders`);
  }
};

export interface LocalMigration {
  version: string;
  run(context: LocalBootstrapContext): Promise<void>;
}

export const LOCAL_MIGRATIONS: readonly LocalMigration[] = [
  { version: '001-assigned-order-status', run: migrateLegacyAssignedOrders },
];

export const runLocalMigrations = async (context: LocalBootstrapContext): Promise<void> => {
  for (const migration of LOCAL_MIGRATIONS) await migration.run(context);
};
