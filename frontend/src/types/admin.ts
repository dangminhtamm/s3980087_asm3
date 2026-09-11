export type {
  AdminOrder,
  AdminOrderStatus,
  AnalyticsComparison,
  AnalyticsOverviewData,
  AnalyticsPeriodMetric,
  AnalyticsRun,
  AnalyticsRunStatus,
  CsvImportResult,
  DeliveryRoute,
  DeliveryVolumePoint,
  DriverLocation,
  DriverStatus,
  FleetDriver,
  GeocodingCandidate,
  HourlyOrderVolumePoint,
  OperationalIssue,
  OrderEvent,
  OrderEventType,
  OrderExceptionReason,
  ProofViewUrl,
  RegionalDeliveryMetric,
  RouteStop,
} from '../../../packages/contracts/index.js';

export interface DataResult<T> {
  data: T;
  isFallback: boolean;
  isQueued?: boolean;
}
