import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AdminOperationsMap } from '../../components/admin/AdminOperationsMap';
import { DeepAnalytics, type AnalyticsDateRange } from '../../components/admin/DeepAnalytics';
import { EmrProgressTimeline } from '../../components/admin/EmrProgressTimeline';
import { MetricCard } from '../../components/admin/MetricCard';
import { OperationalAlerts, type OperationalAlert } from '../../components/admin/OperationalAlerts';
import {
  deriveRecentActivity,
  RecentActivityFeed,
} from '../../components/admin/RecentActivityFeed';
import {
  Button,
  DataSourceBadge,
  ErrorState,
  PageSkeleton,
  StatusBadge,
  useToast,
} from '../../components/ui';
import { useDriverLocationStream } from '../../hooks/useDriverLocationStream';
import {
  getAnalyticsOverview,
  getAnalyticsRun,
  listDrivers,
  listOrders,
  startAnalyticsRun,
} from '../../services/operations';
import type {
  AdminOrder,
  AnalyticsOverviewData,
  AnalyticsRun,
  DriverLocation,
  FleetDriver,
} from '../../types/admin';
import { formatLocationInEnglish } from '../../utils/location';

const LOCATION_STALE_MS = 2 * 60 * 1000;
const DELIVERY_AT_RISK_MS = 45 * 60 * 1000;
const terminalRunStatuses = new Set([
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
  'ABORTED',
  'PENDING_REDRIVE',
]);

const emptyAnalytics: AnalyticsOverviewData = {
  generatedAt: '',
  coverage: { from: '', to: '' },
  period: { from: '', to: '' },
  selectedRegion: null,
  totalOrders: 0,
  deliveredOrders: 0,
  successRate: 0,
  averageDeliveryMinutes: null,
  comparison: {
    previousPeriod: { from: '', to: '' },
    previous: { totalOrders: 0, deliveredOrders: 0, successRate: 0, averageDeliveryMinutes: null },
    totalOrdersChangePercent: null,
    deliveredOrdersChangePercent: null,
    successRateChangePoints: 0,
    averageDeliveryMinutesChangePercent: null,
  },
  deliveryVolumeTrend: [],
  hourlyOrderVolume: [],
  regions: [],
};

const errorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error?.message;
    if (typeof message === 'string') return message;
  }
  return error instanceof Error ? error.message : 'Unable to load the operations control tower';
};

const isAtRisk = (order: AdminOrder, now: number): boolean =>
  ['IN_PROGRESS', 'ARRIVED'].includes(order.status) &&
  now - new Date(order.createdAt).getTime() > DELIVERY_AT_RISK_MS;

const formatLocationAge = (timestamp: string, now: number): string => {
  const ageMinutes = Math.max(0, Math.round((now - new Date(timestamp).getTime()) / 60_000));
  if (ageMinutes < 60) return `${ageMinutes} minute${ageMinutes === 1 ? '' : 's'} ago`;
  const ageHours = Math.round(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours} hour${ageHours === 1 ? '' : 's'} ago`;
  const ageDays = Math.round(ageHours / 24);
  return ageDays > 30 ? 'more than 30 days ago' : `${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
};

const buildAlerts = (
  orders: AdminOrder[],
  drivers: FleetDriver[],
  now: number,
): OperationalAlert[] => {
  const alerts: OperationalAlert[] = [];
  drivers
    .filter(
      (driver) =>
        driver.status !== 'OFFLINE' &&
        (!driver.locationUpdatedAt ||
          now - new Date(driver.locationUpdatedAt).getTime() > LOCATION_STALE_MS),
    )
    .forEach((driver) =>
      alerts.push({
        id: `stale-${driver.driverId}`,
        severity: driver.status === 'ON_DELIVERY' ? 'critical' : 'warning',
        title: `${driver.name} has a stale location`,
        detail: driver.locationUpdatedAt
          ? `Last update ${formatLocationAge(driver.locationUpdatedAt, now)}`
          : 'No location has been received from this driver.',
        to: '/admin/fleet',
      }),
    );
  orders
    .filter((order) => order.status === 'DELIVERY_FAILED')
    .forEach((order) =>
      alerts.push({
        id: `exception-${order.orderId}`,
        severity: 'critical',
        title: 'Delivery exception needs resolution',
        detail: `CF-${order.orderId.slice(0, 8).toUpperCase()} · ${order.exception?.reason.replaceAll('_', ' ') ?? 'Reason unavailable'}`,
        to: `/admin/orders/${order.orderId}`,
      }),
    );
  orders
    .filter((order) => order.status === 'PENDING' && !order.driverId)
    .forEach((order) =>
      alerts.push({
        id: `unassigned-${order.orderId}`,
        severity: 'warning',
        title: `CF-${order.orderId.slice(0, 8).toUpperCase()} is unassigned`,
        detail: `${order.customerName} · ${formatLocationInEnglish(order.region)}`,
        to: '/admin/dispatch',
      }),
    );
  orders
    .filter((order) => isAtRisk(order, now))
    .forEach((order) =>
      alerts.push({
        id: `risk-${order.orderId}`,
        severity: 'critical',
        title: 'Delivery may be running late',
        detail: `CF-${order.orderId.slice(0, 8).toUpperCase()} has been active for more than 45 minutes.`,
        to: '/admin/dispatch',
      }),
    );
  return alerts.sort(
    (left, right) => Number(right.severity === 'critical') - Number(left.severity === 'critical'),
  );
};

export const AnalyticsOverview = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsOverviewData>(emptyAnalytics);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [run, setRun] = useState<AnalyticsRun | null>(null);
  const [isStartingEmr, setIsStartingEmr] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsDateRange | undefined>();

  const handleRealtimeLocation = useCallback((location: DriverLocation) => {
    setDrivers((current) =>
      current.map((driver) =>
        driver.driverId === location.driverId
          ? {
              ...driver,
              lat: location.lat,
              lng: location.lng,
              locationUpdatedAt: location.recordedAt,
              updatedAt: location.recordedAt,
            }
          : driver,
      ),
    );
    setLastUpdated(new Date());
  }, []);
  const realtimeStatus = useDriverLocationStream(handleRealtimeLocation);

  const loadControlTower = useCallback(
    async (
      silent = false,
      range: AnalyticsDateRange | undefined = analyticsRange,
    ): Promise<void> => {
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const [ordersResult, driversResult, analyticsResult] = await Promise.all([
          listOrders({ limit: 100 }),
          listDrivers(),
          getAnalyticsOverview(range),
        ]);
        setOrders(ordersResult.data);
        setDrivers(driversResult.data);
        setAnalytics({
          ...analyticsResult.data,
          regions: analyticsResult.data.regions.map((region) => ({
            ...region,
            region: formatLocationInEnglish(region.region),
          })),
        });
        setIsFallback(
          ordersResult.isFallback || driversResult.isFallback || analyticsResult.isFallback,
        );
        setLastUpdated(new Date());
        setError(null);
      } catch (loadError: unknown) {
        setError(errorMessage(loadError));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [analyticsRange],
  );

  const applyAnalyticsRange = useCallback(
    async (range: AnalyticsDateRange): Promise<void> => {
      setAnalyticsRange(range);
      await loadControlTower(true, range);
    },
    [loadControlTower],
  );

  useEffect(() => {
    void loadControlTower();
    const refreshTimer = window.setInterval(() => void loadControlTower(true), 15_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [loadControlTower]);

  useEffect(() => {
    if (!run || terminalRunStatuses.has(run.status)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void getAnalyticsRun(run.runId)
        .then(async (updatedRun) => {
          if (cancelled) return;
          setRun(updatedRun);
          if (updatedRun.status === 'SUCCEEDED') {
            await loadControlTower(true);
            toast({
              title: 'Analytics refreshed',
              description: 'The latest EMR snapshot is now visible.',
              tone: 'success',
            });
          } else if (terminalRunStatuses.has(updatedRun.status)) {
            setError(updatedRun.error ?? `Analytics refresh ended with ${updatedRun.status}`);
          }
        })
        .catch((runError: unknown) => !cancelled && setError(errorMessage(runError)));
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadControlTower, run, toast]);

  const startEmrRefresh = useCallback(async () => {
    setIsStartingEmr(true);
    setError(null);
    try {
      setRun(await startAnalyticsRun());
      toast({
        title: 'EMR analytics started',
        description: 'CloudFleet will update this page when the Spark job completes.',
        tone: 'info',
      });
    } catch (runError: unknown) {
      setError(errorMessage(runError));
    } finally {
      setIsStartingEmr(false);
    }
  }, [toast]);

  const activeOrders = useMemo(
    () => orders.filter((order) => ['IN_PROGRESS', 'ARRIVED', 'RETURNING'].includes(order.status)),
    [orders],
  );
  const availableDrivers = useMemo(
    () => drivers.filter((driver) => driver.status === 'AVAILABLE'),
    [drivers],
  );
  const atRiskOrders = useMemo(
    () => activeOrders.filter((order) => isAtRisk(order, now)),
    [activeOrders, now],
  );
  const alerts = useMemo(() => buildAlerts(orders, drivers, now), [drivers, now, orders]);
  const activities = useMemo(() => deriveRecentActivity(orders), [orders]);
  const realtimeLabel =
    realtimeStatus === 'connected'
      ? 'WebSocket live'
      : realtimeStatus === 'retrying'
        ? 'WebSocket reconnecting'
        : 'WebSocket connecting';
  const isEmrRunning = run?.status === 'RUNNING';

  return (
    <main className="mx-auto max-w-[100rem] px-4 py-7 sm:px-8 sm:py-10 xl:px-10">
      <header className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-neutral-400 uppercase">
            Operations / Live network
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-neutral-950 sm:text-5xl">
            Operations control tower
          </h1>
          <p className="mt-3 max-w-2xl text-xs leading-5 text-neutral-500">
            A live view of every active delivery, available driver and issue requiring dispatch
            attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            isLoading={isRefreshing}
            onClick={() => void loadControlTower(true)}
          >
            Refresh operations
          </Button>
          <Button
            isLoading={isStartingEmr}
            disabled={isEmrRunning}
            onClick={() => void startEmrRefresh()}
          >
            {isEmrRunning ? 'EMR running…' : 'Refresh analytics'}
          </Button>
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <DataSourceBadge isFallback={isFallback} />
        <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5">
          <StatusBadge
            label={realtimeLabel}
            tone={realtimeStatus === 'connected' ? 'success' : 'warning'}
            pulse={realtimeStatus === 'connected'}
          />
        </span>
        <span className="text-[10px] text-neutral-400">
          {lastUpdated
            ? `Updated ${lastUpdated.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
            : 'Waiting for first refresh'}
        </span>
        {run && (
          <span className="ml-auto text-[10px] font-semibold text-neutral-500">
            EMR · {run.status} · <span className="font-mono">{run.runId.slice(0, 8)}</span>
          </span>
        )}
      </div>

      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={() => void loadControlTower()} compact />
        </div>
      )}

      {isLoading ? (
        <div className="mt-9">
          <PageSkeleton />
        </div>
      ) : (
        <>
          <section className="mt-8 grid gap-px overflow-hidden rounded-2xl bg-neutral-200 ring-1 ring-neutral-200 sm:grid-cols-2 lg:grid-cols-5">
            <MetricCard
              label="Active deliveries"
              value={String(activeOrders.length)}
              detail="Orders currently in transit"
              dotClassName="bg-blue-500"
            />
            <MetricCard
              label="Available drivers"
              value={String(availableDrivers.length)}
              detail={`${drivers.length} drivers in the network`}
              dotClassName="bg-emerald-500"
            />
            <MetricCard
              label="At-risk deliveries"
              value={String(atRiskOrders.length)}
              detail="Active for more than 45 min"
              dotClassName={atRiskOrders.length ? 'bg-red-500' : 'bg-neutral-300'}
            />
            <MetricCard
              label="Success rate"
              value={`${analytics.successRate.toFixed(1)}%`}
              detail={`${analytics.deliveredOrders} deliveries completed`}
              dotClassName="bg-emerald-500"
            />
            <MetricCard
              label="Average delivery"
              value={
                analytics.averageDeliveryMinutes === null
                  ? '—'
                  : `${analytics.averageDeliveryMinutes.toFixed(1)} min`
              }
              detail="Latest EMR operational snapshot"
              dotClassName="bg-amber-500"
            />
          </section>

          <section className="mt-6">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-[9px] font-bold tracking-[0.17em] text-neutral-400 uppercase">
                  Live network
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">
                  Fleet and active destinations
                </h2>
              </div>
              <p className="hidden text-[10px] text-neutral-400 sm:block">
                {drivers.filter((driver) => driver.lat !== null).length} located drivers ·{' '}
                {activeOrders.length} active stops
              </p>
            </div>
            <AdminOperationsMap drivers={drivers} activeOrders={activeOrders} />
          </section>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
            <RecentActivityFeed activities={activities} />
            <OperationalAlerts alerts={alerts} />
          </div>

          <DeepAnalytics
            data={analytics}
            isRefreshing={isRefreshing}
            onApplyRange={applyAnalyticsRange}
          />

          <div className="mt-6 grid gap-6 xl:grid-cols-[0.72fr_1.28fr]">
            <EmrProgressTimeline run={run} />
            <section className="border border-neutral-200 bg-white p-6 sm:p-7">
              <p className="text-[9px] font-bold tracking-[0.18em] text-neutral-400 uppercase">
                Snapshot provenance
              </p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-neutral-950">
                A traceable analytics data product
              </h3>
              <p className="mt-3 max-w-2xl text-xs leading-5 text-neutral-500">
                The API serves a versioned daily rollup generated by Spark from a DynamoDB
                point-in-time export. Date filtering, previous-period comparison and region
                drill-down are calculated from that snapshot without exposing customer records.
              </p>
              <dl className="mt-7 grid gap-5 border-t border-neutral-100 pt-6 sm:grid-cols-3">
                <div>
                  <dt className="text-[9px] font-bold tracking-[0.14em] text-neutral-400 uppercase">
                    Generated
                  </dt>
                  <dd className="mt-2 text-xs font-semibold text-neutral-800">
                    {analytics.generatedAt
                      ? new Date(analytics.generatedAt).toLocaleString('en-AU')
                      : 'Not available'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[9px] font-bold tracking-[0.14em] text-neutral-400 uppercase">
                    Coverage
                  </dt>
                  <dd className="mt-2 text-xs font-semibold text-neutral-800">
                    {analytics.coverage.from} — {analytics.coverage.to}
                  </dd>
                </div>
                <div>
                  <dt className="text-[9px] font-bold tracking-[0.14em] text-neutral-400 uppercase">
                    Storage
                  </dt>
                  <dd className="mt-2 text-xs font-semibold text-neutral-800">
                    S3 / analytics/latest
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </>
      )}
    </main>
  );
};
