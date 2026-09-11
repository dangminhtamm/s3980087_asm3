import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

import { instrumentAwsClient } from '../observability/metrics.js';
import type { AppConfig } from './app-config.js';

export interface ObjectStorageClients {
  client: S3Client;
  presignClient: S3Client;
}

export const createObjectStorageClients = (config: AppConfig): ObjectStorageClients => {
  const clientConfig: S3ClientConfig = { region: config.aws.region };
  if (config.s3.endpoint) clientConfig.endpoint = config.s3.endpoint;
  if (config.s3.forcePathStyle) clientConfig.forcePathStyle = true;

  const client = new S3Client(clientConfig);
  instrumentAwsClient(client.middlewareStack, 'S3');

  // Docker reaches MinIO by service name while browser-facing signatures use localhost.
  const presignClient = config.s3.publicEndpoint
    ? new S3Client({ ...clientConfig, endpoint: config.s3.publicEndpoint })
    : client;

  return { client, presignClient };
};
