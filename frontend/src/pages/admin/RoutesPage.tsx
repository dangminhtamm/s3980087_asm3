import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import { Button, EmptyState, ErrorState, StatusBadge } from '../../components/ui';
import { listRoutes } from '../../services/operations';
import type { DeliveryRoute } from '../../types/admin';

const distance = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
const duration = (seconds: number) => `${Math.round(seconds / 60)} min`;

export const RoutesPage = () => {
  const [routes, setRoutes] = useState<DeliveryRoute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRoutes(await listRoutes({ limit: 100 }));
    } catch {
      setError('Unable to load route plans.');
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <main className="mx-auto max-w-[94rem] px-5 py-8 sm:px-8 sm:py-10 xl:px-12">
      <AdminPageHeader
        eyebrow="Operations / Routes"
        title="Route plans"
        description="Road-aware sequences, ETA revisions and planned-versus-actual performance."
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
        ) : routes.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-xs">
              <thead className="bg-neutral-50 text-[9px] tracking-wider text-neutral-400 uppercase">
                <tr>
                  {['Route', 'Driver', 'Date', 'Plan', 'Optimization', 'Status'].map((value) => (
                    <th key={value} className="border-b border-neutral-200 px-6 py-3">
                      {value}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {routes.map((route) => (
                  <tr key={route.routeId} className="hover:bg-neutral-50">
                    <td className="px-6 py-5">
                      <Link
                        to={`/admin/routes/${route.routeId}`}
                        className="font-mono font-bold underline decoration-neutral-300 underline-offset-4"
                      >
                        RT-{route.routeId.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-6 py-5 font-mono text-[10px]">{route.driverId}</td>
                    <td className="px-6 py-5">{route.scheduledDate}</td>
                    <td className="px-6 py-5">
                      {route.stopCount} stops · {distance(route.plannedDistanceMeters)} ·{' '}
                      {duration(route.plannedDurationSeconds)}
                    </td>
                    <td className="px-6 py-5">
                      {route.optimization.mode} · r{route.optimization.revision}
                      <p className="mt-1 text-[9px] text-neutral-400">
                        {route.optimization.provider}
                      </p>
                    </td>
                    <td className="px-6 py-5">
                      <StatusBadge
                        label={route.status.replace('_', ' ')}
                        tone={
                          route.status === 'COMPLETED'
                            ? 'success'
                            : route.status === 'IN_PROGRESS'
                              ? 'warning'
                              : 'info'
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No optimized routes yet"
            description="Select pending orders on the Orders page and plan a multi-stop route."
            className="m-5"
          />
        )}
      </section>
    </main>
  );
};
