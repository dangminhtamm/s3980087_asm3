import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface LocalBootstrapConfig {
  region: string;
  tableName: string;
  proofBucket: string;
  analyticsBucket: string;
  dynamoEndpoint: string;
  s3Endpoint: string;
}

export interface LocalBootstrapContext extends LocalBootstrapConfig {
  dynamoClient: DynamoDBClient;
  documentClient: DynamoDBDocumentClient;
  storageClient: S3Client;
}

const requiredEnvironment = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export const loadLocalBootstrapConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): LocalBootstrapConfig => ({
  region: requiredEnvironment(environment, 'AWS_REGION'),
  tableName: requiredEnvironment(environment, 'DYNAMODB_TABLE_NAME'),
  proofBucket: requiredEnvironment(environment, 'S3_DELIVERY_PROOF_BUCKET'),
  analyticsBucket: requiredEnvironment(environment, 'S3_ANALYTICS_BUCKET'),
  dynamoEndpoint: requiredEnvironment(environment, 'DYNAMODB_ENDPOINT'),
  s3Endpoint: requiredEnvironment(environment, 'S3_ENDPOINT'),
});

export const createLocalBootstrapContext = (
  config: LocalBootstrapConfig,
): LocalBootstrapContext => {
  const dynamoClient = new DynamoDBClient({
    region: config.region,
    endpoint: config.dynamoEndpoint,
  });
  return {
    ...config,
    dynamoClient,
    documentClient: DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: { removeUndefinedValues: true },
    }),
    storageClient: new S3Client({
      region: config.region,
      endpoint: config.s3Endpoint,
      forcePathStyle: true,
    }),
  };
};
