import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import { Button, EmptyState, ErrorState, StatusBadge } from '../../components/ui';
import { listOperationalIssues } from '../../services/operations';
import type { OperationalIssue } from '../../types/admin';

const when = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';

export const ExceptionsPage = () => {
  const [issues, setIssues] = useState<OperationalIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      setIssues(await listOperationalIssues());
    } catch {
      setError('Unable to load operational exceptions.');
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);
  return (
    <main className="mx-auto max-w-[94rem] px-5 py-8 sm:px-8 sm:py-10 xl:px-12">
      <AdminPageHeader
        eyebrow="Operations / Exceptions"
        title="Attention queue"
        description="Failed deliveries, SLA breaches and predicted late arrivals ranked by urgency."
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        }
      />
      {error && (
        <div className="mt-5">
          <ErrorState message={error} onRetry={() => void load()} compact />
        </div>
      )}
      <section className="mt-8 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        {isLoading ? (
          <div className="h-72 animate-pulse bg-neutral-50" />
        ) : issues.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-xs">
              <thead className="bg-neutral-50 text-[9px] tracking-wider text-neutral-400 uppercase">
                <tr>
                  {[
                    'Priority',
                    'Issue',
                    'Order',
                    'Route / driver',
                    'SLA deadline',
                    'Predicted',
                    'Action',
                  ].map((heading) => (
                    <th key={heading} className="border-b border-neutral-200 px-5 py-3">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {issues.map((issue) => (
                  <tr key={issue.id}>
                    <td className="px-5 py-4">
                      <StatusBadge
                        label={issue.severity}
                        tone={issue.severity === 'CRITICAL' ? 'danger' : 'warning'}
                      />
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-bold">{issue.title}</p>
                      <p className="mt-1 text-[10px] text-neutral-500">{issue.detail}</p>
                    </td>
                    <td className="px-5 py-4 font-mono text-[10px]">
                      CF-{issue.orderId.slice(0, 8).toUpperCase()}
                    </td>
                    <td className="px-5 py-4 text-[10px]">
                      {issue.routeId ? (
                        <Link className="underline" to={`/admin/routes/${issue.routeId}`}>
                          Route
                        </Link>
                      ) : (
                        'No route'
                      )}{' '}
                      · {issue.driverId ?? 'Unassigned'}
                    </td>
                    <td className="px-5 py-4">{when(issue.dueAt)}</td>
                    <td className="px-5 py-4">{when(issue.predictedAt)}</td>
                    <td className="px-5 py-4">
                      <Link
                        to={`/admin/orders/${issue.orderId}`}
                        className="font-bold underline underline-offset-4"
                      >
                        Resolve →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No exceptions need attention"
            description="All active orders are within their SLA and workflow."
            className="m-5"
          />
        )}
      </section>
    </main>
  );
};
