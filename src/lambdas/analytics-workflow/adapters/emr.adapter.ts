import {
  GetJobRunCommand,
  StartJobRunCommand,
  type EMRServerlessClient,
  type JobRunState,
} from '@aws-sdk/client-emr-serverless';
import type { EmrJobPort } from '../ports.js';

const requiredEnvironment = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const idempotencyToken = (runId: string): string =>
  runId.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);

export class AwsEmrAdapter implements EmrJobPort {
  constructor(
    private readonly client: EMRServerlessClient,
    private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async start(runId: string, inputUri: string): Promise<unknown> {
    const applicationId = requiredEnvironment(this.environment, 'EMR_APPLICATION_ID');
    const response = await this.client.send(
      new StartJobRunCommand({
        applicationId,
        clientToken: idempotencyToken(runId),
        executionRoleArn: requiredEnvironment(this.environment, 'EMR_JOB_ROLE_ARN'),
        executionTimeoutMinutes: 60,
        name: `cloudfleet-delivery-analytics-${runId}`,
        mode: 'BATCH',
        retryPolicy: { maxAttempts: 2 },
        jobDriver: {
          sparkSubmit: {
            entryPoint: requiredEnvironment(this.environment, 'EMR_ENTRY_POINT'),
            entryPointArguments: [
              '--input-uri',
              inputUri,
              '--output-bucket',
              requiredEnvironment(this.environment, 'ANALYTICS_BUCKET'),
            ],
            sparkSubmitParameters:
              '--conf spark.driver.cores=1 --conf spark.driver.memory=2g ' +
              '--conf spark.executor.cores=2 --conf spark.executor.memory=4g ' +
              '--conf spark.executor.instances=2',
          },
        },
        tags: { Project: 'CloudFleet', RunId: runId },
      }),
    );
    if (!response.jobRunId) throw new Error('EMR Serverless did not return a job run ID');
    return { runId, jobRunId: response.jobRunId };
  }

  async check(runId: string, jobRunId: string): Promise<unknown> {
    const response = await this.client.send(
      new GetJobRunCommand({
        applicationId: requiredEnvironment(this.environment, 'EMR_APPLICATION_ID'),
        jobRunId,
      }),
    );
    const status: JobRunState | undefined = response.jobRun?.state;
    if (!status) throw new Error('EMR Serverless did not return a job status');
    return { runId, jobRunId, status, stateDetails: response.jobRun?.stateDetails ?? null };
  }
}
