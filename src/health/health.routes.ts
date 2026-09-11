import { DescribeTableCommand, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3';
import { Router } from 'express';

import { asyncHandler } from '../http/async-handler.js';

export interface HealthDependencies {
  databaseClient: Pick<DynamoDBClient, 'send'>;
  objectStorageClient: Pick<S3Client, 'send'>;
  tableName: string;
  deliveryProofBucket: string;
}

export const createHealthRouter = (dependencies: HealthDependencies): Router => {
  const router = Router();

  router.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'cloudfleet-api' });
  });

  router.get(
    '/ready',
    asyncHandler(async (_request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      const [dynamodb, s3] = await Promise.allSettled([
        dependencies.databaseClient.send(
          new DescribeTableCommand({ TableName: dependencies.tableName }),
        ),
        dependencies.objectStorageClient.send(
          new HeadBucketCommand({ Bucket: dependencies.deliveryProofBucket }),
        ),
      ]);
      const dependencyStatus = {
        dynamodb: dynamodb.status === 'fulfilled' ? 'ready' : 'unavailable',
        s3: s3.status === 'fulfilled' ? 'ready' : 'unavailable',
      };
      const ready = dynamodb.status === 'fulfilled' && s3.status === 'fulfilled';

      if (!ready) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'readiness_failed',
            dependencies: dependencyStatus,
          }),
        );
      }

      response.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        service: 'cloudfleet-api',
        dependencies: dependencyStatus,
      });
    }),
  );

  return router;
};
