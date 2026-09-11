import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCloudFleetAuth } from '../../auth/CloudFleetAuth';
import { DataSourceBadge, EmptyState, ErrorState, Skeleton } from '../../components/ui';
import { runtimeEnv } from '../../config/runtime';
import { getOrderEvents, listOrders } from '../../services/operations';
import type { AdminOrder, OrderEvent } from '../../types/admin';
import { formatLocationInEnglish } from '../../utils/location';

type DateRange = '7' | '30' | 'ALL';
type EventMap = Record<string, OrderEvent[]>;

const isInRange = (value: string, range: DateRange): boolean => {
  if (range === 'ALL') return true;
  const cutoff = Date.now() - Number(range) * 24 * 60 * 60 * 1_000;
  return new Date(value).getTime() >= cutoff;
};

const formatDuration = (milliseconds: number): string => {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

export const DriverHistoryPage = () => {
  const auth = useCloudFleetAuth();
  const driverId = auth.user?.username || runtimeEnv('VITE_DRIVER_ID') || 'DRV-018';
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [eventsByOrder, setEventsByOrder] = useState<EventMap>({});
  const [range, setRange] = useState<DateRange>('30');
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listOrders({ driverId, limit: 100 });
      setOrders(result.data);
      setIsFallback(result.isFallback);
      const deliveredOrders = result.data.filter((order) => order.status === 'DELIVERED');
      const eventResults = await Promise.allSettled(
        deliveredOrders.map(
          async (order) => [order.orderId, await getOrderEvents(order.orderId)] as const,
        ),
      );
      setEventsByOrder(
        Object.fromEntries(
          eventResults.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
        ),
      );
    } catch {
      setError('Unable to load delivery history. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const assignmentsInRange = useMemo(
    () => orders.filter((order) => isInRange(order.deliveredAt ?? order.createdAt, range)),
    [orders, range],
  );
  const deliveredInRange = useMemo(
    () =>
      assignmentsInRange
        .filter((order) => order.status === 'DELIVERED' && order.deliveredAt)
        .sort((left, right) => (right.deliveredAt ?? '').localeCompare(left.deliveredAt ?? '')),
    [assignmentsInRange],
  );
  const successRate = assignmentsInRange.length
    ? (deliveredInRange.length / assignmentsInRange.length) * 100
    : 0;
  const activeTimeMs = useMemo(
    () =>
      deliveredInRange.reduce((total, order) => {
        const events = eventsByOrder[order.orderId] ?? [];
        const startedAt =
          events.find((event) => event.type === 'DELIVERY_STARTED')?.occurredAt ?? order.createdAt;
        const completedAt =
          events.find((event) => event.type === 'DELIVERY_COMPLETED')?.occurredAt ??
          order.deliveredAt;
        return completedAt
          ? total + Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime())
          : total;
      }, 0),
    [deliveredInRange, eventsByOrder],
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-teal-700 uppercase">Activity</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Delivery history</h1>
          <p className="mt-2 text-xs text-slate-500">
            Performance calculated from your DynamoDB orders and lifecycle events.
          </p>
        </div>
        <select
          value={range}
          onChange={(event) => setRange(event.target.value as DateRange)}
          aria-label="Date range"
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-slate-950"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="ALL">All time</option>
        </select>
      </div>

      <div className="mt-5">
        <DataSourceBadge isFallback={isFallback} />
      </div>
      {error && (
        <div className="mt-5">
          <ErrorState message={error} onRetry={() => void loadHistory()} compact />
        </div>
      )}

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Metric
          value={String(deliveredInRange.length)}
          label="Delivered"
          helper={`${assignmentsInRange.length} assignments`}
        />
        <Metric
          value={`${successRate.toFixed(successRate % 1 === 0 ? 0 : 1)}%`}
          label="Success rate"
          helper="Delivered ÷ assigned"
        />
        <Metric
          value={formatDuration(activeTimeMs)}
          label="Active time"
          helper="Start → completion"
        />
      </div>

      <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-black">Completed deliveries</h2>
          <span className="text-[10px] text-slate-400">
            {range === 'ALL' ? 'All recorded data' : `${range}-day window`}
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {deliveredInRange.map((order) => {
            const events = eventsByOrder[order.orderId] ?? [];
            const startedAt =
              events.find((event) => event.type === 'DELIVERY_STARTED')?.occurredAt ??
              order.createdAt;
            const elapsed = order.deliveredAt
              ? new Date(order.deliveredAt).getTime() - new Date(startedAt).getTime()
              : 0;
            return (
              <article
                key={order.orderId}
                className="flex items-center gap-4 p-5 transition hover:bg-slate-50 sm:px-6"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-base font-black text-emerald-700">
                  ✓
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-black">{order.customerName}</p>
                    <span className="font-mono text-[9px] text-slate-400">
                      CF-{order.orderId.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {formatLocationInEnglish(order.dropoffAddress)}
                  </p>
                  <p className="mt-1 text-[9px] font-semibold text-slate-400">
                    Active {formatDuration(elapsed)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs font-bold">
                    {new Intl.DateTimeFormat('en-AU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(order.deliveredAt!))}
                  </p>
                  <p className="mt-1 text-[9px] text-slate-400">
                    {new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: 'short' }).format(
                      new Date(order.deliveredAt!),
                    )}
                  </p>
                </div>
              </article>
            );
          })}
          {isLoading && (
            <div className="p-5">
              <Skeleton className="h-32" />
            </div>
          )}
          {!isLoading && deliveredInRange.length === 0 && (
            <EmptyState
              title="No deliveries in this range"
              description="Choose a wider date range or complete your next delivery."
              className="m-4 rounded-2xl"
            />
          )}
        </div>
      </section>
    </main>
  );
};

const Metric = ({ value, label, helper }: { value: string; label: string; helper: string }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <p className="text-xl font-black tracking-tight sm:text-2xl">{value}</p>
    <p className="mt-1 text-[9px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
    <p className="mt-2 hidden text-[9px] text-slate-400 sm:block">{helper}</p>
  </div>
);
