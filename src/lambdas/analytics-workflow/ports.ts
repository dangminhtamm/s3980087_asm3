export type AnalyticsWorkflowEvent =
  | { action: 'START_EXPORT'; runId: string }
  | { action: 'CHECK_EXPORT'; runId: string; exportArn: string }
  | { action: 'START_JOB'; runId: string; inputUri: string }
  | { action: 'CHECK_JOB'; runId: string; jobRunId: string };

export interface DynamoExportPort {
  start(runId: string): Promise<unknown>;
  check(runId: string, exportArn: string): Promise<unknown>;
}

export interface EmrJobPort {
  start(runId: string, inputUri: string): Promise<unknown>;
  check(runId: string, jobRunId: string): Promise<unknown>;
}
