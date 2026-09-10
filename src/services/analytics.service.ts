import { GetObjectCommand, NoSuchKey, type S3Client } from '@aws-sdk/client-s3';

import type {
  AnalyticsOverview,
  AnalyticsOverviewQuery,
  AnalyticsPeriodMetric,
} from '../domain/entities/analytics.js';
import { AppError } from '../errors/app-error.js';
import {
  analyticsSnapshotSchema,
  type AnalyticsSnapshot,
} from '../schemas/analytics.schema.js';

const LATEST_ANALYTICS_KEY = 'analytics/latest/overview.json';
const DAY_MS = 86_400_000;

type DailyRollup = AnalyticsSnapshot['daily'][number];

interface SelectedRollup {
  totalOrders: number;
  deliveredOrders: number;
  totalDeliveryMinutes: number;
  deliveryDurationCount: number;
  hourlyOrderVolume: Array<{ hour: number; orderCount: number }>;
}

interface AggregateAccumulator {
  totalOrders: number;
  deliveredOrders: number;
  totalDeliveryMinutes: number;
  deliveryDurationCount: number;
}

const dateAtUtc = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const isoDay = (value: Date): string => value.toISOString().slice(0, 10);
const addDays = (value: string, days: number): string =>
  isoDay(new Date(dateAtUtc(value).getTime() + days * DAY_MS));
const inclusiveDayCount = (from: string, to: string): number =>
  Math.round((dateAtUtc(to).getTime() - dateAtUtc(from).getTime()) / DAY_MS) + 1;
const round = (value: number): number => Math.round(value * 100) / 100;
const percent = (part: number, total: number): number =>
  total === 0 ? 0 : round((part / total) * 100);
const percentChange = (current: number, previous: number): number | null =>
  previous === 0 ? null : round(((current - previous) / previous) * 100);

const emptyAccumulator = (): AggregateAccumulator => ({
  totalOrders: 0,
  deliveredOrders: 0,
  totalDeliveryMinutes: 0,
  deliveryDurationCount: 0,
});

const toMetric = (value: AggregateAccumulator): AnalyticsPeriodMetric => ({
  totalOrders: value.totalOrders,
  deliveredOrders: value.deliveredOrders,
  successRate: percent(value.deliveredOrders, value.totalOrders),
  averageDeliveryMinutes:
    value.deliveryDurationCount === 0
      ? null
      : round(value.totalDeliveryMinutes / value.deliveryDurationCount),
});

const accumulate = (
  target: AggregateAccumulator,
  source: {
    orderCount?: number;
    totalOrders?: number;
    deliveredOrders: number;
    totalDeliveryMinutes: number;
    deliveryDurationCount: number;
  },
): void => {
  target.totalOrders += source.totalOrders ?? source.orderCount ?? 0;
  target.deliveredOrders += source.deliveredOrders;
  target.totalDeliveryMinutes += source.totalDeliveryMinutes;
  target.deliveryDurationCount += source.deliveryDurationCount;
};

const selectRollup = (day: DailyRollup, region?: string): SelectedRollup => {
  if (!region) return day;
  const regional = day.regions.find((entry) => entry.region === region);
  if (!regional) return {
    totalOrders: 0,
    deliveredOrders: 0,
    totalDeliveryMinutes: 0,
    deliveryDurationCount: 0,
    hourlyOrderVolume: [],
  };
  return { ...regional, totalOrders: regional.orderCount };
};

const aggregatePeriod = (
  daily: DailyRollup[],
  from: string,
  to: string,
  region?: string,
): AnalyticsPeriodMetric => {
  const value = emptyAccumulator();
  daily
    .filter((day) => day.date >= from && day.date <= to)
    .forEach((day) => accumulate(value, selectRollup(day, region)));
  return toMetric(value);
};

export class AnalyticsService {
  public constructor(
    private readonly storage: S3Client,
    private readonly bucketName: string | null,
  ) {}

  public async getOverview(query: AnalyticsOverviewQuery = {}): Promise<AnalyticsOverview> {
    const snapshot = await this.readSnapshot();
    const to = query.to ?? snapshot.coverage.to;
    const from = query.from ?? addDays(to, -29);
    const rangeDays = inclusiveDayCount(from, to);
    if (!Number.isFinite(rangeDays) || rangeDays < 1 || rangeDays > 367) {
      throw new AppError(
        400,
        'Analytics date range must contain between 1 and 367 days',
        'INVALID_ANALYTICS_RANGE',
      );
    }
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -(rangeDays - 1));
    const selectedDays = snapshot.daily.filter(
      (day) => day.date >= from && day.date <= to,
    );
    const current = aggregatePeriod(snapshot.daily, from, to, query.region);
    const previous = aggregatePeriod(
      snapshot.daily,
      previousFrom,
      previousTo,
      query.region,
    );

    const trendByDate = new Map(
      selectedDays.map((day) => {
        const selected = selectRollup(day, query.region);
        return [
          day.date,
          {
            date: day.date,
            orderCount: selected.totalOrders,
            deliveredOrders: selected.deliveredOrders,
          },
        ] as const;
      }),
    );
    const deliveryVolumeTrend = Array.from({ length: rangeDays }, (_, index) => {
      const date = addDays(from, index);
      return trendByDate.get(date) ?? { date, orderCount: 0, deliveredOrders: 0 };
    });

    const hourlyTotals = Array.from({ length: 24 }, () => 0);
    selectedDays.forEach((day) => {
      selectRollup(day, query.region).hourlyOrderVolume.forEach((entry) => {
        hourlyTotals[entry.hour] = (hourlyTotals[entry.hour] ?? 0) + entry.orderCount;
      });
    });

    const regionalAccumulators = new Map<string, AggregateAccumulator>();
    selectedDays.forEach((day) => {
      day.regions.forEach((region) => {
        const value = regionalAccumulators.get(region.region) ?? emptyAccumulator();
        accumulate(value, region);
        regionalAccumulators.set(region.region, value);
      });
    });

    const overallForThreshold = aggregatePeriod(snapshot.daily, from, to);
    const ranked = [...regionalAccumulators.entries()]
      .map(([region, value]) => {
        const metric = toMetric(value);
        return { region, orderCount: metric.totalOrders, ...metric };
      })
      .sort((left, right) => {
        if (left.averageDeliveryMinutes === null) return 1;
        if (right.averageDeliveryMinutes === null) return -1;
        return left.averageDeliveryMinutes - right.averageDeliveryMinutes;
      });
    let speedRank = 0;
    const regions = ranked.map((region) => {
      const rankBySpeed = region.averageDeliveryMinutes === null ? null : ++speedRank;
      const slowThreshold =
        overallForThreshold.averageDeliveryMinutes === null
          ? Number.POSITIVE_INFINITY
          : overallForThreshold.averageDeliveryMinutes * 1.25;
      return {
        region: region.region,
        orderCount: region.orderCount,
        deliveredOrders: region.deliveredOrders,
        successRate: region.successRate,
        averageDeliveryMinutes: region.averageDeliveryMinutes,
        rankBySpeed,
        isAbnormal:
          region.successRate < 90 ||
          (region.averageDeliveryMinutes ?? 0) > slowThreshold,
      };
    });

    return {
      generatedAt: snapshot.generatedAt,
      coverage: snapshot.coverage,
      period: { from, to },
      selectedRegion: query.region ?? null,
      ...current,
      comparison: {
        previousPeriod: { from: previousFrom, to: previousTo },
        previous,
        totalOrdersChangePercent: percentChange(
          current.totalOrders,
          previous.totalOrders,
        ),
        deliveredOrdersChangePercent: percentChange(
          current.deliveredOrders,
          previous.deliveredOrders,
        ),
        successRateChangePoints: round(current.successRate - previous.successRate),
        averageDeliveryMinutesChangePercent:
          current.averageDeliveryMinutes === null ||
          previous.averageDeliveryMinutes === null
            ? null
            : percentChange(
                current.averageDeliveryMinutes,
                previous.averageDeliveryMinutes,
              ),
      },
      deliveryVolumeTrend,
      hourlyOrderVolume: hourlyTotals.map((orderCount, hour) => ({
        hour,
        orderCount,
      })),
      regions,
    };
  }

  private async readSnapshot(): Promise<AnalyticsSnapshot> {
    if (!this.bucketName) {
      throw new AppError(
        503,
        'Analytics storage is not configured',
        'ANALYTICS_NOT_CONFIGURED',
      );
    }
    try {
      const object = await this.storage.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: LATEST_ANALYTICS_KEY,
        }),
      );
      if (!object.Body) throw new Error('Analytics object body is empty');
      const parsed: unknown = JSON.parse(await object.Body.transformToString());
      return analyticsSnapshotSchema.parse(parsed);
    } catch (error: unknown) {
      if (
        error instanceof NoSuchKey ||
        (error instanceof Error && ['NoSuchKey', 'NotFound'].includes(error.name))
      ) {
        throw new AppError(
          404,
          'Analytics snapshot is not available; run the EMR Spark job first',
          'ANALYTICS_NOT_READY',
        );
      }
      throw error;
    }
  }
}
