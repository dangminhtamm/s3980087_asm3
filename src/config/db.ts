import 'dotenv/config';

import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Reads a required environment variable and fails during application startup.
 * This prevents the service from silently connecting to the wrong AWS resource.
 */
const getRequiredEnvironmentVariable = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const clientConfig: DynamoDBClientConfig = {
  region: getRequiredEnvironmentVariable('AWS_REGION'),
};

const localEndpoint = process.env.DYNAMODB_ENDPOINT?.trim();

if (localEndpoint) {
  clientConfig.endpoint = localEndpoint;
}

/**
 * Credentials are intentionally omitted. AWS SDK v3 uses its default provider
 * chain: IAM Identity Center/shared config locally and the ECS task role in AWS.
 */
export const dynamoDBClient = new DynamoDBClient(clientConfig);

/**
 * The document client maps native JavaScript values to DynamoDB AttributeValues.
 * Undefined properties are removed so optional fields cannot break write calls.
 */
export const dynamoDB = DynamoDBDocumentClient.from(dynamoDBClient, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: false,
  },
});

export const ORDERS_TABLE_NAME = getRequiredEnvironmentVariable(
  'DYNAMODB_TABLE_NAME',
);
