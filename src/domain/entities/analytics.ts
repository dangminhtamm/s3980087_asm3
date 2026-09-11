import type {
  AnalyticsComparison,
  AnalyticsOverviewData,
  AnalyticsPeriodMetric,
  DeliveryVolumePoint,
  HourlyOrderVolumePoint,
  RegionalDeliveryMetric,
} from '../../../packages/contracts/index.js';

export type {
  AnalyticsComparison,
  AnalyticsPeriodMetric,
  DeliveryVolumePoint,
  HourlyOrderVolumePoint,
  RegionalDeliveryMetric,
};
export type AnalyticsOverview = AnalyticsOverviewData;

export interface AnalyticsOverviewQuery {
  from?: string | undefined;
  to?: string | undefined;
  region?: string | undefined;
}
