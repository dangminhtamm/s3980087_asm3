import {
  DescribeExportCommand,
  DynamoDBClient,
  ExportTableToPointInTimeCommand,
  type ExportStatus,
} from '@aws-sdk/client-dynamodb';
import {
  EMRServerlessClient,
  GetJobRunCommand,
  StartJobRunCommand,
  type JobRunState,
} from '@aws-sdk/client-emr-serverless';

type WorkflowEvent =
  | { action: 'START_EXPORT'; runId: string }
  | { action: 'CHECK_EXPORT'; runId: string; exportArn: string }
  | { action: 'START_JOB'; runId: string; inputUri: string }
  | { action: 'CHECK_JOB'; runId: string; jobRunId: string };

const dynamodb = new DynamoDBClient({});
const emr = new EMRServerlessClient({});

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const requiredString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing workflow field: ${name}`);
  }
  return value.trim();
};

const idempotencyToken = (runId: string, maxLength: number): string =>
  runId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, maxLength);

const exportDataUri = (
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

const startExport = async (runId: string) => {
  const response = await dynamodb.send(
    new ExportTableToPointInTimeCommand({
      TableArn: requiredEnvironment('TABLE_ARN'),
      ClientToken: idempotencyToken(runId, 32),
      S3Bucket: requiredEnvironment('ANALYTICS_BUCKET'),
      S3Prefix: `dynamodb-exports/${runId}`,
      S3SseAlgorithm: 'AES256',
      ExportFormat: 'DYNAMODB_JSON',
      ExportType: 'FULL_EXPORT',
    }),
  );
  const exportArn = response.ExportDescription?.ExportArn;
  if (!exportArn) throw new Error('DynamoDB did not return an export ARN');

  return { runId, exportArn };
};

const checkExport = async (runId: string, exportArn: string) => {
  const response = await dynamodb.send(new DescribeExportCommand({ ExportArn: exportArn }));
  const description = response.ExportDescription;
  const status: ExportStatus | undefined = description?.ExportStatus;
  if (!description || !status) {
    throw new Error('DynamoDB did not return an export status');
  }

  if (status === 'COMPLETED') {
    const bucket = requiredString(description.S3Bucket, 'export S3 bucket');
    const manifest = requiredString(description.ExportManifest, 'export manifest');
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
    failureCode: description?.FailureCode ?? null,
    failureMessage: description?.FailureMessage ?? null,
  };
};

const startJob = async (runId: string, inputUri: string) => {
  const applicationId = requiredEnvironment('EMR_APPLICATION_ID');
  const response = await emr.send(
    new StartJobRunCommand({
      applicationId,
      clientToken: idempotencyToken(runId, 64),
      executionRoleArn: requiredEnvironment('EMR_JOB_ROLE_ARN'),
      executionTimeoutMinutes: 60,
      name: `cloudfleet-delivery-analytics-${runId}`,
      mode: 'BATCH',
      retryPolicy: { maxAttempts: 2 },
      jobDriver: {
        sparkSubmit: {
          entryPoint: requiredEnvironment('EMR_ENTRY_POINT'),
          entryPointArguments: [
            '--input-uri',
            inputUri,
            '--output-bucket',
            requiredEnvironment('ANALYTICS_BUCKET'),
          ],
          sparkSubmitParameters:
            '--conf spark.driver.cores=1 ' +
            '--conf spark.driver.memory=2g ' +
            '--conf spark.executor.cores=2 ' +
            '--conf spark.executor.memory=4g ' +
            '--conf spark.executor.instances=2',
        },
      },
      tags: { Project: 'CloudFleet', RunId: runId },
    }),
  );
  const jobRunId = response.jobRunId;
  if (!jobRunId) throw new Error('EMR Serverless did not return a job run ID');

  return { runId, jobRunId };
};

const checkJob = async (runId: string, jobRunId: string) => {
  const response = await emr.send(
    new GetJobRunCommand({
      applicationId: requiredEnvironment('EMR_APPLICATION_ID'),
      jobRunId,
    }),
  );
  const status: JobRunState | undefined = response.jobRun?.state;
  if (!status) throw new Error('EMR Serverless did not return a job status');

  return {
    runId,
    jobRunId,
    status,
    stateDetails: response.jobRun?.stateDetails ?? null,
  };
};

/** One short action per invocation; Step Functions owns waits, retries and branching. */
export const handler = async (event: WorkflowEvent): Promise<unknown> => {
  const runId = requiredString(event.runId, 'runId');

  switch (event.action) {
    case 'START_EXPORT':
      return startExport(runId);
    case 'CHECK_EXPORT':
      return checkExport(runId, requiredString(event.exportArn, 'exportArn'));
    case 'START_JOB':
      return startJob(runId, requiredString(event.inputUri, 'inputUri'));
    case 'CHECK_JOB':
      return checkJob(runId, requiredString(event.jobRunId, 'jobRunId'));
    default: {
      const exhaustive: never = event;
      throw new Error(`Unsupported analytics workflow action: ${String(exhaustive)}`);
    }
  }
};
