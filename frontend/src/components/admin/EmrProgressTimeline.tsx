import type { AnalyticsRun } from '../../types/admin';

const idleSteps: AnalyticsRun['progress']['steps'] = [
  { id: 'EXPORT', label: 'Export DynamoDB snapshot', status: 'PENDING', timestamp: null },
  { id: 'EMR_START', label: 'Start EMR Serverless', status: 'PENDING', timestamp: null },
  { id: 'SPARK', label: 'Run Spark aggregation', status: 'PENDING', timestamp: null },
  { id: 'PUBLISH', label: 'Publish analytics snapshot', status: 'PENDING', timestamp: null },
];

export const EmrProgressTimeline = ({ run }: { run: AnalyticsRun | null }) => {
  const steps = run?.progress.steps ?? idleSteps;
  const percent = run?.progress.percent ?? 0;

  return (
    <section className="border border-neutral-200 bg-neutral-950 p-6 text-white sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[9px] font-bold tracking-[0.18em] text-neutral-500 uppercase">
            Pipeline status
          </p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">EMR refresh timeline</h3>
        </div>
        <span className="font-mono text-2xl font-semibold">{percent}%</span>
      </div>
      <div className="mt-5 h-1 overflow-hidden bg-neutral-800">
        <div
          className="h-full bg-white transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol className="mt-6 space-y-0">
        {steps.map((step, index) => {
          const isDone = step.status === 'COMPLETED';
          const isRunning = step.status === 'RUNNING';
          const isFailed = step.status === 'FAILED';
          return (
            <li key={step.id} className="relative flex min-h-14 gap-4 pb-5 last:min-h-0 last:pb-0">
              {index < steps.length - 1 && (
                <span
                  className={`absolute top-3 left-[5px] h-full w-px ${isDone ? 'bg-white' : 'bg-neutral-800'}`}
                />
              )}
              <span
                className={`relative z-10 mt-1 size-3 shrink-0 rounded-full border-2 ${isFailed ? 'border-red-400 bg-red-500' : isDone ? 'border-white bg-white' : isRunning ? 'animate-pulse border-amber-300 bg-amber-400' : 'border-neutral-700 bg-neutral-950'}`}
              />
              <div className="min-w-0">
                <p
                  className={`text-xs font-semibold ${step.status === 'PENDING' ? 'text-neutral-500' : 'text-white'}`}
                >
                  {step.label}
                </p>
                <p className="mt-1 text-[9px] font-semibold tracking-[0.12em] text-neutral-600 uppercase">
                  {step.timestamp
                    ? new Date(step.timestamp).toLocaleTimeString('en-AU', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : step.status}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-6 border-t border-neutral-800 pt-4 text-[10px] leading-4 text-neutral-500">
        {run
          ? `${run.progress.currentStep} · run ${run.runId.slice(0, 8)}`
          : 'Start an analytics refresh to monitor the AWS Step Functions execution.'}
      </p>
    </section>
  );
};
