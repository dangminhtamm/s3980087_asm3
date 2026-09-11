import {
  DescribeExportCommand,
  ExportTableToPointInTimeCommand,
  type DynamoDBClient,
  type ExportStatus,
} from '@aws-sdk/client-dynamodb';
import type { DynamoExportPort } from '../ports.js';

const requiredEnvironment = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const idempotencyToken = (runId: string): string =>
  runId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32);

export const exportDataUri = (
  bucket: string,
  manifestKey: string,
  s3Prefix: string | undefined,
): string => {
  const suffix = 'manifest-summary.json';
  const normalizedPrefix = s3Prefix?.replace(/^\/+|\/+$/g, '');
  let normalizedManifest = manifestKey.replace(/^\/+/, '');
  if (normalizedPrefix && !normalizedManifest.startsWith(`${normalizedPrefix}/`)) {
    normalizedManifest = `${normalizedPrefix}/${normalizedManifest}`;
  }
  if (!normalizedManifest.endsWith(suffix)) {
    throw new Error(`Unexpected DynamoDB export manifest: ${manifestKey}`);
  }
  return `s3://${bucket}/${normalizedManifest.slice(0, -suffix.length)}data/*.json.gz`;
};

export class AwsDynamoExportAdapter implements DynamoExportPort {
  constructor(
    private readonly client: DynamoDBClient,
    private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async start(runId: string): Promise<unknown> {
    const response = await this.client.send(
      new ExportTableToPointInTimeCommand({
        TableArn: requiredEnvironment(this.environment, 'TABLE_ARN'),
        ClientToken: idempotencyToken(runId),
        S3Bucket: requiredEnvironment(this.environment, 'ANALYTICS_BUCKET'),
        S3Prefix: `dynamodb-exports/${runId}`,
        S3SseAlgorithm: 'AES256',
        ExportFormat: 'DYNAMODB_JSON',
        ExportType: 'FULL_EXPORT',
      }),
    );
    const exportArn = response.ExportDescription?.ExportArn;
    if (!exportArn) throw new Error('DynamoDB did not return an export ARN');
    return { runId, exportArn };
  }

  async check(runId: string, exportArn: string): Promise<unknown> {
    const response = await this.client.send(new DescribeExportCommand({ ExportArn: exportArn }));
    const description = response.ExportDescription;
    const status: ExportStatus | undefined = description?.ExportStatus;
    if (!description || !status) throw new Error('DynamoDB did not return an export status');
    if (status === 'COMPLETED') {
      const bucket = description.S3Bucket;
      const manifest = description.ExportManifest;
      if (!bucket || !manifest) throw new Error('DynamoDB export output is incomplete');
      return {
        runId,
        exportArn,
        status,
        inputUri: exportDataUri(bucket, manifest, description.S3Prefix),
      };
    }
    return {
      runId,
      exportArn,
      status,
      failureCode: description.FailureCode ?? null,
      failureMessage: description.FailureMessage ?? null,
    };
  }
}
