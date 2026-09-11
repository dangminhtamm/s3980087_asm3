import { AdminOperationsMap } from '../../../components/admin/AdminOperationsMap';
import { DeepAnalytics, type AnalyticsDateRange } from '../../../components/admin/DeepAnalytics';
import { EmrProgressTimeline } from '../../../components/admin/EmrProgressTimeline';
import { MetricCard } from '../../../components/admin/MetricCard';
import {
  OperationalAlerts,
  type OperationalAlert,
} from '../../../components/admin/OperationalAlerts';
import {
  RecentActivityFeed,
  type OperationalActivity,
} from '../../../components/admin/RecentActivityFeed';
import {
  Button,
  DataSourceBadge,
  ErrorState,
  PageSkeleton,
  StatusBadge,
} from '../../../components/ui';
import type {
  AdminOrder,
  AnalyticsOverviewData,
  AnalyticsRun,
  FleetDriver,
} from '../../../types/admin';

interface Props {
  activeOrders: AdminOrder[];
  availableDrivers: FleetDriver[];
  atRiskOrders: AdminOrder[];
  drivers: FleetDriver[];
  analytics: AnalyticsOverviewData;
  activities: OperationalActivity[];
  alerts: OperationalAlert[];
  isLoading: boolean;
  isRefreshing: boolean;
  isFallback: boolean;
  isStartingEmr: boolean;
  isEmrRunning: boolean;
  error: string | null;
  lastUpdated: Date | null;
  run: AnalyticsRun | null;
  realtimeLabel: string;
  realtimeStatus: 'connecting' | 'connected' | 'retrying';
  refresh(): Promise<void>;
  retry(): Promise<void>;
  startEmr(): Promise<void>;
  applyRange(range: AnalyticsDateRange): Promise<void>;
}

export const AnalyticsOverviewView = (props: Props) => {
  const {
    activeOrders,
    availableDrivers,
    atRiskOrders,
    drivers,
    analytics,
    activities,
    alerts,
    isLoading,
    isRefreshing,
    isFallback,
    isStartingEmr,
    isEmrRunning,
    error,
    lastUpdated,
    run,
    realtimeLabel,
    realtimeStatus,
  } = props;
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
          <Button variant="secondary" isLoading={isRefreshing} onClick={() => void props.refresh()}>
            Refresh operations
          </Button>
          <Button
            isLoading={isStartingEmr}
            disabled={isEmrRunning}
            onClick={() => void props.startEmr()}
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
          <ErrorState message={error} onRetry={() => void props.retry()} compact />
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
            onApplyRange={props.applyRange}
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
