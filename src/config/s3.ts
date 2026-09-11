import 'dotenv/config';

import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { instrumentAwsClient } from '../observability/metrics.js';

const getRequiredEnvironmentVariable = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const clientConfig: S3ClientConfig = {
  region: getRequiredEnvironmentVariable('AWS_REGION'),
};

const serviceEndpoint = process.env.S3_ENDPOINT?.trim();
const publicSigningEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim();
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE?.trim() === 'true';

if (serviceEndpoint) {
  clientConfig.endpoint = serviceEndpoint;
}

if (forcePathStyle) {
  clientConfig.forcePathStyle = true;
}

/** Credentials come from the AWS SDK default chain/ECS task role. */
export const s3Client = new S3Client(clientConfig);
instrumentAwsClient(s3Client.middlewareStack, 'S3');

/**
 * A Docker container reaches local S3 through its Compose hostname, while the
 * browser reaches it through `localhost`. Presigned URLs include the host
 * in their signature, so local development needs a separate signing endpoint.
 * In AWS both clients intentionally collapse to the same instance.
 */
export const s3PresignClient = publicSigningEndpoint
  ? new S3Client({
      ...clientConfig,
      endpoint: publicSigningEndpoint,
    })
  : s3Client;

export const DELIVERY_PROOF_BUCKET = getRequiredEnvironmentVariable('S3_DELIVERY_PROOF_BUCKET');

export const ANALYTICS_BUCKET = process.env.S3_ANALYTICS_BUCKET?.trim() || null;
