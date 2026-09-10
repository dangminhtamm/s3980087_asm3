export type AdminOrderStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RESCHEDULED'
  | 'CANCELLED'
  | 'RETURNING'
  | 'RETURNED';

export type OrderExceptionReason =
  | 'CUSTOMER_UNAVAILABLE'
  | 'INVALID_ADDRESS'
  | 'CUSTOMER_REJECTED'
  | 'DAMAGED_PACKAGE'
  | 'VEHICLE_ISSUE'
  | 'WEATHER_OR_TRAFFIC'
  | 'DUPLICATE_ORDER'
  | 'CUSTOMER_CANCELLED'
  | 'OTHER';

export interface AdminOrder {
  orderId: string;
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  region: string;
  lat: number;
  lng: number;
  status: AdminOrderStatus;
  driverId: string | null;
  createdAt: string;
  deliveredAt: string | null;
  exception: {
    reason: OrderExceptionReason;
    notes: string | null;
    reportedAt: string;
    reportedBy: string;
  } | null;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
  packageWeightKg?: number;
  packageVolumeM3?: number;
  serviceDurationMinutes?: number;
  routeId?: string | null;
  stopSequence?: number | null;
  startedAt?: string | null;
  arrivedAt?: string | null;
  plannedArrivalAt?: string | null;
  customerRescheduleRequest?: {
    requestedWindowStart: string;
    requestedWindowEnd: string;
    notes: string | null;
    requestedAt: string;
  } | null;
}

export type DriverStatus = 'AVAILABLE' | 'ON_DELIVERY' | 'OFFLINE';

export interface FleetDriver {
  driverId: string;
  name: string;
  phone: string;
  vehiclePlate: string;
  currentArea: string;
  status: DriverStatus;
  completedToday: number;
  lat: number | null;
  lng: number | null;
  locationUpdatedAt: string | null;
  updatedAt: string;
  maxWeightKg?: number;
  maxVolumeM3?: number;
}

export interface RouteStop {
  routeId: string;
  orderId: string;
  sequence: number;
  status: AdminOrderStatus;
  dropoffAddress: string;
  lat: number;
  lng: number;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  packageWeightKg: number;
  packageVolumeM3: number;
  serviceDurationMinutes: number;
  plannedArrivalAt: string;
  plannedDepartureAt: string;
  plannedTravelDurationSeconds: number;
  plannedDistanceMeters: number;
  actualArrivalAt: string | null;
  etaAt: string;
  delayMinutes: number;
  slaStatus: 'NO_WINDOW' | 'ON_TIME' | 'AT_RISK' | 'LATE';
}

export interface DeliveryRoute {
  routeId: string;
  driverId: string;
  scheduledDate: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  stopCount: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  createdAt: string;
  createdBy: string;
  origin: { lat: number; lng: number };
  plannedDistanceMeters: number;
  plannedDurationSeconds: number;
  geometry: Array<[number, number]>;
  optimization: { provider: string; mode: 'AUTO' | 'MANUAL'; optimizedAt: string; revision: number };
  comparison: {
    plannedDurationSeconds: number;
    actualDurationSeconds: number | null;
    varianceSeconds: number | null;
    completedStops: number;
    onTimeStops: number;
    lateStops: number;
  };
  stops: RouteStop[];
}

export interface OperationalIssue {
  id: string;
  type: 'DELIVERY_EXCEPTION' | 'RESCHEDULE_REQUIRED' | 'CUSTOMER_RESCHEDULE_REQUEST' | 'SLA_BREACH' | 'SLA_RISK' | 'UNASSIGNED_URGENT';
  severity: 'CRITICAL' | 'WARNING' | 'NOTICE';
  orderId: string;
  routeId: string | null;
  driverId: string | null;
  title: string;
  detail: string;
  dueAt: string | null;
  predictedAt: string | null;
}

export interface GeocodingCandidate {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  region: string | null;
  importance: number;
}

export interface CsvImportResult {
  created: number;
  failed: number;
  results: Array<{ row: number; orderId?: string; error?: { code: string; message: string } }>;
}

export interface DriverLocation {
  driverId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: string;
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

export interface DeliveryVolumePoint {
  date: string;
  orderCount: number;
  deliveredOrders: number;
}

export interface HourlyOrderVolumePoint {
  hour: number;
  orderCount: number;
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

export interface AnalyticsOverviewData extends AnalyticsPeriodMetric {
  generatedAt: string;
  coverage: { from: string; to: string };
  period: { from: string; to: string };
  selectedRegion: string | null;
  comparison: AnalyticsComparison;
  deliveryVolumeTrend: DeliveryVolumePoint[];
  hourlyOrderVolume: HourlyOrderVolumePoint[];
  regions: RegionalDeliveryMetric[];
}

export type AnalyticsRunStatus =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'ABORTED'
  | 'PENDING_REDRIVE';

export interface AnalyticsRun {
  runId: string;
  status: AnalyticsRunStatus;
  startedAt: string;
  stoppedAt: string | null;
  error: string | null;
  progress: {
    percent: number;
    currentStep: string;
    steps: Array<{
      id: 'EXPORT' | 'EMR_START' | 'SPARK' | 'PUBLISH';
      label: string;
      status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
      timestamp: string | null;
    }>;
  };
}

export interface DataResult<T> {
  data: T;
  isFallback: boolean;
  isQueued?: boolean;
}

export type OrderEventType =
  | 'ORDER_CREATED'
  | 'DRIVER_ASSIGNED'
  | 'DELIVERY_STARTED'
  | 'DRIVER_ARRIVED'
  | 'PROOF_UPLOADED'
  | 'DELIVERY_COMPLETED'
  | 'DELIVERY_FAILED'
  | 'DELIVERY_RESCHEDULED'
  | 'ORDER_CANCELLED'
  | 'CUSTOMER_RESCHEDULE_REQUESTED'
  | 'CUSTOMER_FEEDBACK_RECEIVED'
  | 'RETURN_STARTED'
  | 'ORDER_RETURNED'
  | 'SMS_NOTIFICATION_SENT'
  | 'SMS_NOTIFICATION_FAILED';

export interface OrderEvent {
  eventId: string;
  orderId: string;
  type: OrderEventType;
  occurredAt: string;
  actorId: string;
  source: 'RECORDED' | 'DERIVED';
  metadata: Record<string, string>;
}

export interface ProofViewUrl {
  viewUrl: string;
  expiresIn: number;
}
