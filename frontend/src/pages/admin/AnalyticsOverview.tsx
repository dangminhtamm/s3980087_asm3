import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { AnalyticsDateRange } from '../../components/admin/DeepAnalytics';
import type { OperationalAlert } from '../../components/admin/OperationalAlerts';
import { deriveRecentActivity } from '../../components/admin/RecentActivityFeed';
import { useToast } from '../../components/ui';
import { useDriverLocationStream } from '../../hooks/useDriverLocationStream';
import {
  getAnalyticsOverview,
  getAnalyticsRun,
  startAnalyticsRun,
} from '../../features/analytics/api/analytics.client';
import { listDrivers } from '../../features/drivers/api/drivers.client';
import { listOrders } from '../../features/orders/api/orders.client';
import type {
  AdminOrder,
  AnalyticsOverviewData,
  AnalyticsRun,
  DriverLocation,
  FleetDriver,
} from '../../types/admin';
import { formatLocationInEnglish } from '../../utils/location';
import { AnalyticsOverviewView } from '../../features/analytics/components/AnalyticsOverviewView';

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
    <AnalyticsOverviewView
      activeOrders={activeOrders}
      availableDrivers={availableDrivers}
      atRiskOrders={atRiskOrders}
      drivers={drivers}
      analytics={analytics}
      activities={activities}
      alerts={alerts}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      isFallback={isFallback}
      isStartingEmr={isStartingEmr}
      isEmrRunning={isEmrRunning}
      error={error}
      lastUpdated={lastUpdated}
      run={run}
      realtimeLabel={realtimeLabel}
      realtimeStatus={realtimeStatus}
      refresh={() => loadControlTower(true)}
      retry={() => loadControlTower()}
      startEmr={startEmrRefresh}
      applyRange={applyAnalyticsRange}
    />
  );
};
