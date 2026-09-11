import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { instrumentAwsClient } from '../observability/metrics.js';
import type { AppConfig } from './app-config.js';

export interface DatabaseClients {
  client: DynamoDBClient;
  document: DynamoDBDocumentClient;
}

export const createDatabaseClients = (config: AppConfig): DatabaseClients => {
  const clientConfig: DynamoDBClientConfig = { region: config.aws.region };
  if (config.dynamodb.endpoint) clientConfig.endpoint = config.dynamodb.endpoint;

  // Credentials intentionally use the AWS SDK default provider chain.
  const client = new DynamoDBClient(clientConfig);
  const document = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
  });
  instrumentAwsClient(document.middlewareStack, 'DynamoDB');
  return { client, document };
};
