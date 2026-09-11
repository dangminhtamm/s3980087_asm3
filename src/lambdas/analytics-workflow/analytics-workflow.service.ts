import type { AnalyticsWorkflowEvent, DynamoExportPort, EmrJobPort } from './ports.js';

const requiredString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing workflow field: ${name}`);
  }
  return value.trim();
};

export class AnalyticsWorkflowService {
  constructor(
    private readonly exports: DynamoExportPort,
    private readonly jobs: EmrJobPort,
  ) {}

  execute(event: AnalyticsWorkflowEvent): Promise<unknown> {
    const runId = requiredString(event.runId, 'runId');
    switch (event.action) {
      case 'START_EXPORT':
        return this.exports.start(runId);
      case 'CHECK_EXPORT':
        return this.exports.check(runId, requiredString(event.exportArn, 'exportArn'));
      case 'START_JOB':
        return this.jobs.start(runId, requiredString(event.inputUri, 'inputUri'));
      case 'CHECK_JOB':
        return this.jobs.check(runId, requiredString(event.jobRunId, 'jobRunId'));
    }
  }
}
