import { randomUUID } from 'node:crypto';

import {
  DescribeExecutionCommand,
  ExecutionDoesNotExist,
  GetExecutionHistoryCommand,
  ListExecutionsCommand,
  StartExecutionCommand,
  type HistoryEvent,
  type SFNClient,
} from '@aws-sdk/client-sfn';

import type {
  AnalyticsRun,
  AnalyticsRunProgress,
  AnalyticsRunStep,
} from '../domain/entities/analytics-run.js';
import { AppError } from '../errors/app-error.js';

const executionName = (runId: string): string => `analytics-${runId}`;

const executionArnFor = (stateMachineArn: string, runId: string): string => {
  const marker = ':stateMachine:';
  const markerIndex = stateMachineArn.indexOf(marker);

  if (markerIndex < 0) {
    throw new Error('ANALYTICS_STATE_MACHINE_ARN is not a valid state machine ARN');
  }

  const arnPrefix = stateMachineArn.slice(0, markerIndex);
  const stateMachineName = stateMachineArn.slice(markerIndex + marker.length);
  return `${arnPrefix}:execution:${stateMachineName}:${executionName(runId)}`;
};

const parseExecutionError = (cause: string | undefined): string | null => {
  if (!cause) return null;

  try {
    const parsed: unknown = JSON.parse(cause);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'errorMessage' in parsed &&
      typeof parsed.errorMessage === 'string'
    ) {
      return parsed.errorMessage;
    }
  } catch {
    // Step Functions also returns plain-text causes.
  }

  return cause.slice(0, 500);
};

const enteredStates = (events: HistoryEvent[]): Map<string, string> => {
  const states = new Map<string, string>();
  events.forEach((event) => {
    const name = event.stateEnteredEventDetails?.name;
    if (name && event.timestamp) states.set(name, event.timestamp.toISOString());
  });
  return states;
};

const buildProgress = (
  status: AnalyticsRun['status'],
  events: HistoryEvent[] = [],
): AnalyticsRunProgress => {
  const states = enteredStates(events);
  const exportStarted = states.get('StartDynamoDbExport') ?? null;
  const emrStarted = states.get('StartEmrServerlessJob') ?? null;
  const sparkStarted = states.get('WaitForEmrServerlessJob') ?? null;
  const published = states.get('AnalyticsRefreshCompleted') ?? null;
  const terminalFailure = ['FAILED', 'TIMED_OUT', 'ABORTED'].includes(status);

  const definitions: Array<{
    id: AnalyticsRunStep['id'];
    label: string;
    started: string | null;
    completed: boolean;
  }> = [
    {
      id: 'EXPORT',
      label: 'Export DynamoDB snapshot',
      started: exportStarted,
      completed: Boolean(emrStarted),
    },
    {
      id: 'EMR_START',
      label: 'Start EMR Serverless',
      started: emrStarted,
      completed: Boolean(sparkStarted),
    },
    {
      id: 'SPARK',
      label: 'Run Spark aggregation',
      started: sparkStarted,
      completed: Boolean(published),
    },
    {
      id: 'PUBLISH',
      label: 'Publish analytics snapshot',
      started: published,
      completed: status === 'SUCCEEDED',
    },
  ];
  const activeIndex = Math.max(
    0,
    definitions.findIndex((step) => step.started && !step.completed),
  );
  const failedIndex = terminalFailure
    ? Math.max(
        0,
        definitions.findIndex((step) => !step.completed),
      )
    : -1;
  const steps: AnalyticsRunStep[] = definitions.map((step, index) => ({
    id: step.id,
    label: step.label,
    status: step.completed
      ? 'COMPLETED'
      : failedIndex === index
        ? 'FAILED'
        : step.started || (index === 0 && status === 'RUNNING')
          ? 'RUNNING'
          : 'PENDING',
    timestamp: step.started,
  }));
  const completedCount = steps.filter((step) => step.status === 'COMPLETED').length;
  const percent =
    status === 'SUCCEEDED'
      ? 100
      : Math.min(95, completedCount * 25 + (status === 'RUNNING' ? 10 : 0));
  const currentIndex =
    status === 'SUCCEEDED' ? steps.length - 1 : failedIndex >= 0 ? failedIndex : activeIndex;
  const current = steps[currentIndex] ?? steps[0]!;

  return { percent, currentStep: current.label, steps };
};

export class AnalyticsRunService {
  public constructor(
    private readonly workflows: SFNClient,
    private readonly stateMachineArn: string | null,
  ) {}

  public async start(requestedBy: string): Promise<AnalyticsRun> {
    const stateMachineArn = this.requireStateMachineArn();
    const running = await this.workflows.send(
      new ListExecutionsCommand({
        stateMachineArn,
        statusFilter: 'RUNNING',
        maxResults: 1,
      }),
    );

    if (running.executions?.[0]) {
      throw new AppError(
        409,
        'An analytics refresh is already running',
        'ANALYTICS_RUN_IN_PROGRESS',
      );
    }

    const runId = randomUUID();
    const started = await this.workflows.send(
      new StartExecutionCommand({
        stateMachineArn,
        name: executionName(runId),
        input: JSON.stringify({
          runId,
          requestedBy,
          requestedAt: new Date().toISOString(),
        }),
      }),
    );

    return {
      runId,
      status: 'RUNNING',
      startedAt: (started.startDate ?? new Date()).toISOString(),
      stoppedAt: null,
      error: null,
      progress: buildProgress('RUNNING'),
    };
  }

  public async get(runId: string): Promise<AnalyticsRun> {
    const stateMachineArn = this.requireStateMachineArn();

    try {
      const executionArn = executionArnFor(stateMachineArn, runId);
      const [execution, history] = await Promise.all([
        this.workflows.send(new DescribeExecutionCommand({ executionArn })),
        this.workflows.send(
          new GetExecutionHistoryCommand({
            executionArn,
            reverseOrder: true,
            maxResults: 100,
            includeExecutionData: false,
          }),
        ),
      ]);

      if (!execution.status || !execution.startDate) {
        throw new Error('Step Functions returned an incomplete execution');
      }

      return {
        runId,
        status: execution.status,
        startedAt: execution.startDate.toISOString(),
        stoppedAt: execution.stopDate?.toISOString() ?? null,
        error: parseExecutionError(execution.cause ?? execution.error),
        progress: buildProgress(execution.status, history.events ?? []),
      };
    } catch (error: unknown) {
      if (
        error instanceof ExecutionDoesNotExist ||
        (error instanceof Error && error.name === 'ExecutionDoesNotExist')
      ) {
        throw new AppError(404, 'Analytics run was not found', 'ANALYTICS_RUN_NOT_FOUND');
      }
      throw error;
    }
  }

  private requireStateMachineArn(): string {
    if (!this.stateMachineArn) {
      throw new AppError(
        503,
        'AWS analytics automation is not configured in this environment',
        'ANALYTICS_AUTOMATION_NOT_CONFIGURED',
      );
    }
    return this.stateMachineArn;
  }
}
