export interface DeliveryVolumePoint {
  date: string;
  orderCount: number;
  deliveredOrders: number;
}

export interface HourlyOrderVolumePoint {
  hour: number;
  orderCount: number;
}

export interface RegionalDeliveryMetric {
  region: string;
  orderCount: number;
  deliveredOrders: number;
  successRate: number;
  averageDeliveryMinutes: number | null;
  rankBySpeed: number | null;
  isAbnormal: boolean;
}

export interface AnalyticsPeriodMetric {
  totalOrders: number;
  deliveredOrders: number;
  successRate: number;
  averageDeliveryMinutes: number | null;
}

export interface AnalyticsComparison {
  previousPeriod: { from: string; to: string };
  previous: AnalyticsPeriodMetric;
  totalOrdersChangePercent: number | null;
  deliveredOrdersChangePercent: number | null;
  successRateChangePoints: number;
  averageDeliveryMinutesChangePercent: number | null;
}

export interface AnalyticsOverview extends AnalyticsPeriodMetric {
  generatedAt: string;
  coverage: { from: string; to: string };
  period: { from: string; to: string };
  selectedRegion: string | null;
  comparison: AnalyticsComparison;
  deliveryVolumeTrend: DeliveryVolumePoint[];
  hourlyOrderVolume: HourlyOrderVolumePoint[];
  regions: RegionalDeliveryMetric[];
}

export interface AnalyticsOverviewQuery {
  from?: string | undefined;
  to?: string | undefined;
  region?: string | undefined;
}
