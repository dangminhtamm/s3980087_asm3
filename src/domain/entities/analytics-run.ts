import type { ExecutionStatus } from '@aws-sdk/client-sfn';

export type AnalyticsRunStepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface AnalyticsRunStep {
  id: 'EXPORT' | 'EMR_START' | 'SPARK' | 'PUBLISH';
  label: string;
  status: AnalyticsRunStepStatus;
  timestamp: string | null;
}

export interface AnalyticsRunProgress {
  percent: number;
  currentStep: string;
  steps: AnalyticsRunStep[];
}

export interface AnalyticsRun {
  runId: string;
  status: ExecutionStatus;
  startedAt: string;
  stoppedAt: string | null;
  error: string | null;
  progress: AnalyticsRunProgress;
}
