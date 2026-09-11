import {
  CreateTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutBucketCorsCommand,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import type { LocalBootstrapContext } from './config.js';

export const isNamedError = (error: unknown, names: string[]): boolean =>
  error instanceof Error && names.includes(error.name);

const waitFor = async (label: string, check: () => Promise<unknown>): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      await check();
      console.info(`${label} is ready`);
      return;
    } catch (error: unknown) {
      lastError = error;
      if (attempt < 40) await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error(`${label} did not become ready`, { cause: lastError });
};

const ensureTable = async (context: LocalBootstrapContext): Promise<void> => {
  try {
    await context.dynamoClient.send(new DescribeTableCommand({ TableName: context.tableName }));
    console.info(`DynamoDB table ${context.tableName} already exists`);
    return;
  } catch (error: unknown) {
    if (!isNamedError(error, ['ResourceNotFoundException'])) throw error;
  }
  await context.dynamoClient.send(
    new CreateTableCommand({
      TableName: context.tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  await waitUntilTableExists(
    { client: context.dynamoClient, maxWaitTime: 30 },
    { TableName: context.tableName },
  );
  console.info(`Created DynamoDB table ${context.tableName}`);
};

const ensureBucket = async (context: LocalBootstrapContext, bucketName: string): Promise<void> => {
  try {
    await context.storageClient.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.info(`S3 bucket ${bucketName} already exists`);
    return;
  } catch {
    // Missing on the first run.
  }
  await context.storageClient.send(
    new CreateBucketCommand({
      Bucket: bucketName,
      ...(context.region === 'us-east-1'
        ? {}
        : {
            CreateBucketConfiguration: {
              LocationConstraint: context.region as BucketLocationConstraint,
            },
          }),
    }),
  );
  console.info(`Created S3 bucket ${bucketName}`);
};

export const setupLocalResources = async (context: LocalBootstrapContext): Promise<void> => {
  await Promise.all([
    waitFor('DynamoDB Local', () => context.dynamoClient.send(new ListTablesCommand({}))),
    waitFor('MinIO S3', () => context.storageClient.send(new ListBucketsCommand({}))),
  ]);
  await ensureTable(context);
  await Promise.all([
    ensureBucket(context, context.proofBucket),
    ensureBucket(context, context.analyticsBucket),
  ]);
  try {
    await context.storageClient.send(
      new PutBucketCorsCommand({
        Bucket: context.proofBucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedMethods: ['PUT'],
              AllowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
              AllowedHeaders: ['Content-Type', 'x-amz-meta-orderid'],
              ExposeHeaders: ['ETag'],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
  } catch (error: unknown) {
    if (!isNamedError(error, ['NotImplemented', 'NotImplementedException'])) throw error;
    console.info('Bucket-level CORS is unavailable; using MinIO global CORS');
  }
};
