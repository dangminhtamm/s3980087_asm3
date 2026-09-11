import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { DeliveryMap } from '../../components/DeliveryMap';
import { Button, ErrorState, PageSkeleton, StatusBadge, useToast } from '../../components/ui';
import { getRoute, reorderRoute, reoptimizeRoute } from '../../features/routes/api/routes.client';
import type { DeliveryRoute } from '../../types/admin';

const time = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : '—';
const minutes = (seconds: number | null) =>
  seconds === null ? 'In progress' : `${Math.round(seconds / 60)} min`;

export const RouteDetailPage = () => {
  const { routeId } = useParams<{ routeId: string }>();
  const { toast } = useToast();
  const [route, setRoute] = useState<DeliveryRoute | null>(null);
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!routeId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getRoute(routeId);
      setRoute(data);
      setOrderIds(data.stops.map((stop) => stop.orderId));
    } catch {
      setError('Unable to load this route.');
    } finally {
      setIsLoading(false);
    }
  }, [routeId]);
  useEffect(() => {
    void load();
  }, [load]);
  const move = (index: number, direction: -1 | 1) =>
    setOrderIds((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  const mutate = async (kind: 'manual' | 'auto') => {
    if (!routeId) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated =
        kind === 'manual' ? await reorderRoute(routeId, orderIds) : await reoptimizeRoute(routeId);
      setRoute(updated);
      setOrderIds(updated.stops.map((stop) => stop.orderId));
      toast({
        title: kind === 'manual' ? 'Manual order saved' : 'Route re-optimized',
        description: `Plan revision ${updated.optimization.revision} is now active.`,
        tone: 'success',
      });
    } catch (mutationError: unknown) {
      setError(
        axios.isAxiosError(mutationError)
          ? String(mutationError.response?.data?.error?.message ?? 'Unable to update route.')
          : 'Unable to update route.',
      );
    } finally {
      setIsSaving(false);
    }
  };
  if (isLoading)
    return (
      <main className="mx-auto max-w-[94rem] px-5 py-10">
        <PageSkeleton />
      </main>
    );
  if (!route)
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <ErrorState message={error ?? 'Route not found.'} onRetry={() => void load()} />
      </main>
    );
  const byId = new Map(route.stops.map((stop) => [stop.orderId, stop]));
  const planned = route.comparison.plannedDurationSeconds;
  const actual = route.comparison.actualDurationSeconds;
  return (
    <main className="mx-auto max-w-[94rem] px-5 py-8 sm:px-8 sm:py-10 xl:px-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            to="/admin/routes"
            className="text-[10px] font-bold tracking-wider text-neutral-400 uppercase"
          >
            ← Routes
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            Route RT-{route.routeId.slice(0, 8).toUpperCase()}
          </h1>
          <p className="mt-2 text-xs text-neutral-500">
            {route.driverId} · {route.scheduledDate} · {route.optimization.provider} · revision{' '}
            {route.optimization.revision}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={route.status !== 'PLANNED'}
            isLoading={isSaving}
            onClick={() => void mutate('auto')}
          >
            Re-optimize
          </Button>
          <Button
            disabled={route.status !== 'PLANNED'}
            isLoading={isSaving}
            onClick={() => void mutate('manual')}
          >
            Save order
          </Button>
        </div>
      </div>
      {error && (
        <div className="mt-5">
          <ErrorState message={error} compact />
        </div>
      )}
      <section className="mt-8 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <DeliveryMap
            orderLocation={route.geometry.at(-1) ?? [route.origin.lat, route.origin.lng]}
            driverLocation={[route.origin.lat, route.origin.lng]}
            routePath={route.geometry}
            address="Final route stop"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="Planned duration" value={minutes(planned)} />
          <Metric label="Actual / elapsed" value={minutes(actual)} />
          <Metric
            label="Variance"
            value={
              route.comparison.varianceSeconds === null
                ? 'Pending'
                : `${route.comparison.varianceSeconds >= 0 ? '+' : ''}${minutes(route.comparison.varianceSeconds)}`
            }
          />
          <Metric
            label="Distance"
            value={`${(route.plannedDistanceMeters / 1000).toFixed(1)} km`}
          />
          <Metric
            label="Completed"
            value={`${route.comparison.completedStops}/${route.stopCount}`}
          />
          <Metric
            label="SLA"
            value={`${route.comparison.onTimeStops} on time · ${route.comparison.lateStops} late`}
          />
        </div>
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <header className="border-b border-neutral-200 px-5 py-4">
          <h2 className="text-sm font-bold">Stop sequence</h2>
          <p className="mt-1 text-[10px] text-neutral-400">
            Move stops manually, then save; or ask the optimizer to recalculate road ETA.
          </p>
        </header>
        <div className="divide-y divide-neutral-100">
          {orderIds.map((orderId, index) => {
            const stop = byId.get(orderId)!;
            return (
              <div
                key={orderId}
                className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 px-5 py-4"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-neutral-950 text-[10px] font-bold text-white">
                  {index + 1}
                </span>
                <div>
                  <Link
                    to={`/admin/orders/${orderId}`}
                    className="text-xs font-bold hover:underline"
                  >
                    {stop.dropoffAddress}
                  </Link>
                  <p className="mt-1 text-[10px] text-neutral-400">
                    ETA {time(stop.plannedArrivalAt)} · window {time(stop.timeWindowStart)}–
                    {time(stop.timeWindowEnd)} · {(stop.plannedDistanceMeters / 1000).toFixed(1)} km
                    leg
                  </p>
                  <div className="mt-2 flex gap-2">
                    <StatusBadge
                      label={stop.slaStatus.replace('_', ' ')}
                      tone={
                        stop.slaStatus === 'LATE'
                          ? 'danger'
                          : stop.slaStatus === 'AT_RISK'
                            ? 'warning'
                            : stop.slaStatus === 'ON_TIME'
                              ? 'success'
                              : 'neutral'
                      }
                    />
                    <StatusBadge label={stop.status.replaceAll('_', ' ')} tone="neutral" />
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    disabled={index === 0 || route.status !== 'PLANNED'}
                    onClick={() => move(index, -1)}
                    className="size-8 rounded border border-neutral-200 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    disabled={index === orderIds.length - 1 || route.status !== 'PLANNED'}
                    onClick={() => move(index, 1)}
                    className="size-8 rounded border border-neutral-200 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-2xl border border-neutral-200 bg-white p-5">
    <p className="text-[9px] font-bold tracking-wider text-neutral-400 uppercase">{label}</p>
    <p className="mt-3 text-xl font-semibold">{value}</p>
  </div>
);
