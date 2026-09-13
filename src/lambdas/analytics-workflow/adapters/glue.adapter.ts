import {
  GetJobRunCommand,
  StartJobRunCommand,
  type GlueClient,
  type JobRunState,
} from '@aws-sdk/client-glue';
import type { AnalyticsJobPort } from '../ports.js';

const requiredEnvironment = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const normalizedStatus = (
  state: JobRunState,
): 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'CANCELLING' | 'RUNNING' => {
  if (state === 'SUCCEEDED') return 'SUCCESS';
  if (state === 'STOPPED') return 'CANCELLED';
  if (state === 'STOPPING') return 'CANCELLING';
  if (['FAILED', 'TIMEOUT', 'ERROR', 'EXPIRED'].includes(state)) return 'FAILED';
  return 'RUNNING';
};

export class AwsGlueAdapter implements AnalyticsJobPort {
  constructor(
    private readonly client: GlueClient,
    private readonly environment: NodeJS.ProcessEnv,
  ) {}

  async start(runId: string, inputUri: string): Promise<unknown> {
    const response = await this.client.send(
      new StartJobRunCommand({
        JobName: requiredEnvironment(this.environment, 'GLUE_JOB_NAME'),
        Arguments: {
          '--input-uri': inputUri,
          '--output-bucket': requiredEnvironment(this.environment, 'ANALYTICS_BUCKET'),
          '--output-key': 'analytics/latest/overview.json',
        },
      }),
    );
    if (!response.JobRunId) throw new Error('AWS Glue did not return a job run ID');
    return { runId, jobRunId: response.JobRunId };
  }

  async check(runId: string, jobRunId: string): Promise<unknown> {
    const response = await this.client.send(
      new GetJobRunCommand({
        JobName: requiredEnvironment(this.environment, 'GLUE_JOB_NAME'),
        RunId: jobRunId,
        PredecessorsIncluded: false,
      }),
    );
    const state = response.JobRun?.JobRunState;
    if (!state) throw new Error('AWS Glue did not return a job status');
    return {
      runId,
      jobRunId,
      status: normalizedStatus(state),
      stateDetails: response.JobRun?.ErrorMessage ?? null,
    };
  }
}
