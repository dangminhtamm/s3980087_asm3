import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { getAnalyticsOverview } from '../../services/operations';
import type { AnalyticsOverviewData } from '../../types/admin';
import { formatLocationInEnglish } from '../../utils/location';
import { Button, Drawer, ErrorState } from '../ui';

export interface AnalyticsDateRange {
  from: string;
  to: string;
}

interface DeepAnalyticsProps {
  data: AnalyticsOverviewData;
  isRefreshing: boolean;
  onApplyRange: (range: AnalyticsDateRange) => Promise<void>;
}

const chartTooltipStyle = {
  border: '1px solid #e5e5e5',
  borderRadius: 8,
  boxShadow: '0 12px 30px rgba(0,0,0,0.08)',
  fontSize: 11,
};

const shortDate = (date: string): string =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });

const comparisonLabel = (value: number | null, suffix = '%'): string => {
  if (value === null) return 'No prior data';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}${suffix}`;
};

const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const ChartHeader = ({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) => (
  <header className="border-b border-neutral-100 px-5 py-5 sm:px-7">
    <p className="text-[9px] font-bold tracking-[0.17em] text-neutral-400 uppercase">{eyebrow}</p>
    <div className="mt-1 flex items-end justify-between gap-4">
      <h3 className="text-sm font-bold tracking-tight text-neutral-950">{title}</h3>
      <p className="hidden text-[10px] text-neutral-400 sm:block">{detail}</p>
    </div>
  </header>
);

const AnalyticsMetric = ({
  label,
  value,
  change,
  inverse = false,
}: {
  label: string;
  value: string;
  change: number | null;
  inverse?: boolean;
}) => {
  const improved = change !== null && (inverse ? change <= 0 : change >= 0);
  return (
    <article className="bg-white p-5 sm:p-6">
      <p className="text-[9px] font-bold tracking-[0.16em] text-neutral-400 uppercase">{label}</p>
      <p className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-neutral-950">{value}</p>
      <p
        className={`mt-3 text-[10px] font-semibold ${change === null ? 'text-neutral-400' : improved ? 'text-emerald-700' : 'text-red-600'}`}
      >
        {comparisonLabel(change)} vs previous period
      </p>
    </article>
  );
};

export const DeepAnalytics = ({ data, isRefreshing, onApplyRange }: DeepAnalyticsProps) => {
  const [draft, setDraft] = useState<AnalyticsDateRange>(data.period);
  const [isApplying, setIsApplying] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [regionData, setRegionData] = useState<AnalyticsOverviewData | null>(null);
  const [isLoadingRegion, setIsLoadingRegion] = useState(false);
  const [regionError, setRegionError] = useState<string | null>(null);

  useEffect(() => setDraft(data.period), [data.period]);

  const apply = useCallback(
    async (range: AnalyticsDateRange) => {
      setIsApplying(true);
      try {
        await onApplyRange(range);
        setSelectedRegion(null);
        setRegionData(null);
      } finally {
        setIsApplying(false);
      }
    },
    [onApplyRange],
  );

  const submitRange = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (draft.from && draft.to && draft.from <= draft.to) void apply(draft);
    },
    [apply, draft],
  );

  const selectPreset = useCallback(
    (days: number | 'all') => {
      const range =
        days === 'all'
          ? data.coverage
          : { from: addDays(data.coverage.to, -(days - 1)), to: data.coverage.to };
      setDraft(range);
      void apply(range);
    },
    [apply, data.coverage],
  );

  const openRegion = useCallback(
    async (region: string) => {
      setSelectedRegion(region);
      setRegionData(null);
      setRegionError(null);
      setIsLoadingRegion(true);
      try {
        const result = await getAnalyticsOverview({
          from: data.period.from,
          to: data.period.to,
          region,
        });
        setRegionData({ ...result.data, selectedRegion: formatLocationInEnglish(region) });
      } catch (error: unknown) {
        setRegionError(error instanceof Error ? error.message : 'Unable to load region analytics');
      } finally {
        setIsLoadingRegion(false);
      }
    },
    [data.period.from, data.period.to],
  );

  const regionChartData = useMemo(
    () =>
      data.regions.map((region) => ({
        ...region,
        displayRegion: formatLocationInEnglish(region.region),
      })),
    [data.regions],
  );
  const rankedRegions = useMemo(
    () =>
      [...regionChartData]
        .filter((region) => region.averageDeliveryMinutes !== null)
        .sort(
          (left, right) => (left.averageDeliveryMinutes ?? 0) - (right.averageDeliveryMinutes ?? 0),
        ),
    [regionChartData],
  );
  const fastest = rankedRegions[0] ?? null;
  const slowest = rankedRegions.at(-1) ?? null;

  return (
    <section className="mt-14 border-t border-neutral-300 pt-10">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[9px] font-bold tracking-[0.19em] text-neutral-400 uppercase">
            EMR intelligence / historical network
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-neutral-950 sm:text-3xl">
            Delivery performance analytics
          </h2>
          <p className="mt-2 text-xs text-neutral-500">
            Aggregated from the latest DynamoDB export · click any region to drill down.
          </p>
        </div>
        <form
          onSubmit={submitRange}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-white p-2"
        >
          <label className="px-2 py-1 text-[9px] font-bold tracking-[0.12em] text-neutral-400 uppercase">
            From
            <input
              type="date"
              min={data.coverage.from}
              max={draft.to || data.coverage.to}
              value={draft.from}
              onChange={(event) =>
                setDraft((current) => ({ ...current, from: event.target.value }))
              }
              className="mt-1 block bg-transparent text-xs font-semibold tracking-normal text-neutral-900 outline-none"
            />
          </label>
          <span className="mb-2 hidden text-neutral-300 sm:block">→</span>
          <label className="px-2 py-1 text-[9px] font-bold tracking-[0.12em] text-neutral-400 uppercase">
            To
            <input
              type="date"
              min={draft.from || data.coverage.from}
              max={data.coverage.to}
              value={draft.to}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
              className="mt-1 block bg-transparent text-xs font-semibold tracking-normal text-neutral-900 outline-none"
            />
          </label>
          <Button
            size="sm"
            isLoading={isApplying || isRefreshing}
            disabled={!draft.from || !draft.to || draft.from > draft.to}
            type="submit"
          >
            Apply range
          </Button>
        </form>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((days) => (
          <button
            key={days}
            type="button"
            onClick={() => selectPreset(days)}
            className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[10px] font-bold text-neutral-500 hover:border-neutral-950 hover:text-neutral-950"
          >
            Last {days} days
          </button>
        ))}
        <button
          type="button"
          onClick={() => selectPreset('all')}
          className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-[10px] font-bold text-neutral-500 hover:border-neutral-950 hover:text-neutral-950"
        >
          All history
        </button>
        <p className="ml-auto text-[10px] text-neutral-400">
          Current {shortDate(data.period.from)} — {shortDate(data.period.to)} · Previous{' '}
          {shortDate(data.comparison.previousPeriod.from)} —{' '}
          {shortDate(data.comparison.previousPeriod.to)}
        </p>
      </div>

      <div className="mt-6 grid gap-px overflow-hidden rounded-2xl bg-neutral-200 ring-1 ring-neutral-200 sm:grid-cols-2 xl:grid-cols-4">
        <AnalyticsMetric
          label="Delivery volume"
          value={data.totalOrders.toLocaleString('en-AU')}
          change={data.comparison.totalOrdersChangePercent}
        />
        <AnalyticsMetric
          label="Completed"
          value={data.deliveredOrders.toLocaleString('en-AU')}
          change={data.comparison.deliveredOrdersChangePercent}
        />
        <AnalyticsMetric
          label="Success rate"
          value={`${data.successRate.toFixed(1)}%`}
          change={data.comparison.successRateChangePoints}
        />
        <AnalyticsMetric
          label="Average delivery"
          value={
            data.averageDeliveryMinutes === null
              ? '—'
              : `${data.averageDeliveryMinutes.toFixed(1)} min`
          }
          change={data.comparison.averageDeliveryMinutesChangePercent}
          inverse
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_0.55fr]">
        <section className="border border-neutral-200 bg-white">
          <ChartHeader
            eyebrow="Network volume"
            title="Orders and completed deliveries"
            detail="Daily rollup"
          />
          <div className="h-80 px-2 py-6 pr-5 sm:px-5 sm:pr-8">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.deliveryVolumeTrend}
                margin={{ top: 8, right: 6, left: -15, bottom: 0 }}
                accessibilityLayer
              >
                <CartesianGrid vertical={false} stroke="#ececea" strokeDasharray="2 4" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={28}
                  tick={{ fill: '#a3a3a3', fontSize: 9 }}
                  tickMargin={12}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#a3a3a3', fontSize: 9 }} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelFormatter={(label) => shortDate(String(label))}
                />
                <Line
                  type="monotone"
                  dataKey="orderCount"
                  name="Orders"
                  stroke="#171717"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="deliveredOrders"
                  name="Completed"
                  stroke="#a3a3a3"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="border border-neutral-200 bg-white">
          <ChartHeader eyebrow="Daily rhythm" title="Order volume by hour" detail="00:00 — 23:00" />
          <div className="h-80 px-2 py-6 pr-5 sm:px-5 sm:pr-7">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data.hourlyOrderVolume}
                margin={{ top: 8, right: 4, left: -24, bottom: 0 }}
                accessibilityLayer
              >
                <CartesianGrid vertical={false} stroke="#eeeeec" />
                <XAxis
                  dataKey="hour"
                  tickFormatter={(hour) => `${String(hour).padStart(2, '0')}:00`}
                  interval={3}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#a3a3a3', fontSize: 8 }}
                  tickMargin={10}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#a3a3a3', fontSize: 8 }} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelFormatter={(hour) => `${String(hour).padStart(2, '0')}:00`}
                />
                <Bar dataKey="orderCount" name="Orders" fill="#262626" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_1.2fr_0.6fr]">
        <section className="border border-neutral-200 bg-white">
          <ChartHeader eyebrow="Speed" title="Average time by region" detail="Click to inspect" />
          <div className="h-80 px-3 py-6 pr-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={regionChartData}
                layout="vertical"
                margin={{ top: 0, right: 10, left: 6, bottom: 0 }}
                accessibilityLayer
              >
                <CartesianGrid horizontal={false} stroke="#eeeeec" />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#a3a3a3', fontSize: 9 }}
                  unit="m"
                />
                <YAxis
                  type="category"
                  dataKey="displayRegion"
                  width={82}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#525252', fontSize: 9 }}
                />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar
                  dataKey="averageDeliveryMinutes"
                  name="Average delivery"
                  unit=" min"
                  radius={[0, 3, 3, 0]}
                  onClick={(entry) => void openRegion(String(entry.payload.region))}
                  className="cursor-pointer"
                >
                  {regionChartData.map((region) => (
                    <Cell key={region.region} fill={region.isAbnormal ? '#dc2626' : '#262626'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="border border-neutral-200 bg-white">
          <ChartHeader
            eyebrow="Reliability"
            title="Success rate by region"
            detail="Warning below 90%"
          />
          <div className="h-80 px-3 py-6 pr-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={regionChartData}
                layout="vertical"
                margin={{ top: 0, right: 10, left: 6, bottom: 0 }}
                accessibilityLayer
              >
                <CartesianGrid horizontal={false} stroke="#eeeeec" />
                <XAxis
                  type="number"
                  domain={[80, 100]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#a3a3a3', fontSize: 9 }}
                  unit="%"
                />
                <YAxis
                  type="category"
                  dataKey="displayRegion"
                  width={82}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#525252', fontSize: 9 }}
                />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar
                  dataKey="successRate"
                  name="Success rate"
                  unit="%"
                  radius={[0, 3, 3, 0]}
                  onClick={(entry) => void openRegion(String(entry.payload.region))}
                  className="cursor-pointer"
                >
                  {regionChartData.map((region) => (
                    <Cell
                      key={region.region}
                      fill={region.successRate < 90 ? '#dc2626' : '#737373'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="border border-neutral-200 bg-white p-6">
          <p className="text-[9px] font-bold tracking-[0.17em] text-neutral-400 uppercase">
            Region ranking
          </p>
          <div className="mt-6 border-b border-neutral-100 pb-6">
            <p className="text-[10px] font-bold text-emerald-700 uppercase">Fastest</p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-neutral-950">
              {fastest?.displayRegion ?? '—'}
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              {fastest?.averageDeliveryMinutes?.toFixed(1) ?? '—'} min average
            </p>
          </div>
          <div className="pt-6">
            <p className="text-[10px] font-bold text-red-600 uppercase">Slowest</p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-neutral-950">
              {slowest?.displayRegion ?? '—'}
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              {slowest?.averageDeliveryMinutes?.toFixed(1) ?? '—'} min average
            </p>
          </div>
          <button
            type="button"
            onClick={() => slowest && void openRegion(slowest.region)}
            className="mt-7 w-full border-t border-neutral-100 pt-4 text-left text-[10px] font-bold text-neutral-500 hover:text-neutral-950"
          >
            Inspect slowest region →
          </button>
        </section>
      </div>

      <Drawer
        isOpen={selectedRegion !== null}
        onClose={() => setSelectedRegion(null)}
        title={`${selectedRegion ?? 'Region'} drill-down`}
      >
        {isLoadingRegion && (
          <div className="py-16 text-center text-xs text-neutral-400">Loading regional rollup…</div>
        )}
        {regionError && (
          <ErrorState
            compact
            message={regionError}
            onRetry={() => selectedRegion && void openRegion(selectedRegion)}
          />
        )}
        {regionData && (
          <div>
            <p className="text-[10px] font-semibold text-neutral-400">
              {shortDate(regionData.period.from)} — {shortDate(regionData.period.to)}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-neutral-200 ring-1 ring-neutral-200">
              <AnalyticsMetric
                label="Orders"
                value={regionData.totalOrders.toLocaleString('en-AU')}
                change={regionData.comparison.totalOrdersChangePercent}
              />
              <AnalyticsMetric
                label="Success"
                value={`${regionData.successRate.toFixed(1)}%`}
                change={regionData.comparison.successRateChangePoints}
              />
              <AnalyticsMetric
                label="Completed"
                value={regionData.deliveredOrders.toLocaleString('en-AU')}
                change={regionData.comparison.deliveredOrdersChangePercent}
              />
              <AnalyticsMetric
                label="Average time"
                value={
                  regionData.averageDeliveryMinutes === null
                    ? '—'
                    : `${regionData.averageDeliveryMinutes.toFixed(1)} min`
                }
                change={regionData.comparison.averageDeliveryMinutesChangePercent}
                inverse
              />
            </div>
            <div className="mt-7 border border-neutral-200">
              <ChartHeader
                eyebrow="Regional volume"
                title="Daily order trend"
                detail="Selected period"
              />
              <div className="h-60 px-2 py-5 pr-5">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={regionData.deliveryVolumeTrend} margin={{ left: -25, right: 4 }}>
                    <CartesianGrid vertical={false} stroke="#eeeeec" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={22}
                      tick={{ fontSize: 8, fill: '#a3a3a3' }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 8, fill: '#a3a3a3' }}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelFormatter={(label) => shortDate(String(label))}
                    />
                    <Line
                      type="monotone"
                      dataKey="orderCount"
                      name="Orders"
                      stroke="#171717"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
};
