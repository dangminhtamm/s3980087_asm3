export const ORDER_STATUSES: readonly [
  'PENDING',
  'ASSIGNED',
  'IN_PROGRESS',
  'ARRIVED',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RESCHEDULED',
  'CANCELLED',
  'RETURNING',
  'RETURNED',
];
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const UPDATABLE_ORDER_STATUSES: readonly [
  'IN_PROGRESS',
  'ARRIVED',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RESCHEDULED',
  'CANCELLED',
  'RETURNING',
  'RETURNED',
];
export type UpdatableOrderStatus = (typeof UPDATABLE_ORDER_STATUSES)[number];

export const ORDER_EXCEPTION_REASONS: readonly [
  'CUSTOMER_UNAVAILABLE',
  'INVALID_ADDRESS',
  'CUSTOMER_REJECTED',
  'DAMAGED_PACKAGE',
  'VEHICLE_ISSUE',
  'WEATHER_OR_TRAFFIC',
  'DUPLICATE_ORDER',
  'CUSTOMER_CANCELLED',
  'OTHER',
];
export type OrderExceptionReason = (typeof ORDER_EXCEPTION_REASONS)[number];

export const DRIVER_STATUSES: readonly ['AVAILABLE', 'ON_DELIVERY', 'OFFLINE'];
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const ROUTE_STATUSES: readonly ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const ALLOWED_PROOF_CONTENT_TYPES: readonly ['image/jpeg', 'image/png', 'image/webp'];
export type ProofContentType = (typeof ALLOWED_PROOF_CONTENT_TYPES)[number];

export const ORDER_EVENT_TYPES: readonly [
  'ORDER_CREATED',
  'DRIVER_ASSIGNED',
  'DELIVERY_STARTED',
  'DRIVER_ARRIVED',
  'PROOF_UPLOADED',
  'DELIVERY_COMPLETED',
  'DELIVERY_FAILED',
  'DELIVERY_RESCHEDULED',
  'ORDER_CANCELLED',
  'CUSTOMER_RESCHEDULE_REQUESTED',
  'CUSTOMER_FEEDBACK_RECEIVED',
  'RETURN_STARTED',
  'ORDER_RETURNED',
  'SMS_NOTIFICATION_SENT',
  'SMS_NOTIFICATION_FAILED',
];
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];
export type OrderEventSource = 'RECORDED' | 'DERIVED';

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export interface OrderExceptionDto {
  reason: OrderExceptionReason;
  notes: string | null;
  reportedAt: string;
  reportedBy: string;
}

export interface CustomerRescheduleRequestDto {
  requestedWindowStart: string;
  requestedWindowEnd: string;
  notes: string | null;
  requestedAt: string;
}

export interface OrderDto {
  orderId: string;
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  region: string;
  lat: number;
  lng: number;
  status: OrderStatus;
  driverId: string | null;
  createdAt: string;
  deliveredAt: string | null;
  exception: OrderExceptionDto | null;
  timeWindowStart: string | null;
  timeWindowEnd: string | null;
  packageWeightKg: number;
  packageVolumeM3: number;
  serviceDurationMinutes: number;
  routeId: string | null;
  stopSequence: number | null;
  startedAt: string | null;
  arrivedAt: string | null;
  plannedArrivalAt: string | null;
  customerRescheduleRequest: CustomerRescheduleRequestDto | null;
}

export type AdminOrderDto = Omit<
  OrderDto,
  | 'timeWindowStart'
  | 'timeWindowEnd'
  | 'packageWeightKg'
  | 'packageVolumeM3'
  | 'serviceDurationMinutes'
  | 'routeId'
  | 'stopSequence'
  | 'startedAt'
  | 'arrivedAt'
  | 'plannedArrivalAt'
  | 'customerRescheduleRequest'
> &
  Partial<
    Pick<
      OrderDto,
      | 'timeWindowStart'
      | 'timeWindowEnd'
      | 'packageWeightKg'
      | 'packageVolumeM3'
      | 'serviceDurationMinutes'
      | 'routeId'
      | 'stopSequence'
      | 'startedAt'
      | 'arrivedAt'
      | 'plannedArrivalAt'
      | 'customerRescheduleRequest'
    >
  >;

export interface DriverDto {
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
  maxWeightKg: number;
  maxVolumeM3: number;
}

export type FleetDriverDto = Omit<DriverDto, 'maxWeightKg' | 'maxVolumeM3'> &
  Partial<Pick<DriverDto, 'maxWeightKg' | 'maxVolumeM3'>>;

export interface DriverLocationDto {
  driverId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: string;
}

export interface OrderEventDto {
  eventId: string;
  orderId: string;
  type: OrderEventType;
  occurredAt: string;
  actorId: string;
  source: OrderEventSource;
  metadata: Record<string, string>;
}

export type AdminOrderStatus = OrderStatus;
export type AdminOrder = AdminOrderDto;
export type FleetDriver = FleetDriverDto;
export type DriverLocation = DriverLocationDto;
export type OrderEvent = OrderEventDto;

export interface RouteStop {
  routeId: string;
  orderId: string;
  sequence: number;
  status: OrderStatus;
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

export interface RouteComparison {
  plannedDurationSeconds: number;
  actualDurationSeconds: number | null;
  varianceSeconds: number | null;
  completedStops: number;
  onTimeStops: number;
  lateStops: number;
}

export interface DeliveryRoute {
  routeId: string;
  driverId: string;
  scheduledDate: string;
  status: RouteStatus;
  stopCount: number;
  totalWeightKg: number;
  totalVolumeM3: number;
  createdAt: string;
  createdBy: string;
  origin: { lat: number; lng: number };
  plannedDistanceMeters: number;
  plannedDurationSeconds: number;
  geometry: Array<[number, number]>;
  optimization: {
    provider: string;
    mode: 'AUTO' | 'MANUAL';
    optimizedAt: string;
    revision: number;
  };
  comparison: RouteComparison;
  stops: RouteStop[];
}

export interface OperationalIssue {
  id: string;
  type:
    | 'DELIVERY_EXCEPTION'
    | 'RESCHEDULE_REQUIRED'
    | 'CUSTOMER_RESCHEDULE_REQUEST'
    | 'SLA_BREACH'
    | 'SLA_RISK'
    | 'UNASSIGNED_URGENT';
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
  'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED' | 'PENDING_REDRIVE';

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

export interface ProofGpsLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: string;
}

export interface DeliveryProof {
  orderId: string;
  objectKey: string;
  contentType: ProofContentType;
  size: number;
  etag: string;
  uploadedBy: string;
  uploadedAt: string;
  recipientName: string | null;
  signatureDataUrl: string | null;
  barcode: string | null;
  notes: string | null;
  gps: ProofGpsLocation | null;
}

export interface PresignedUpload {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
  requiredHeaders: Record<string, string>;
}

export interface ProofViewUrl {
  viewUrl: string;
  expiresIn: number;
}

export interface TrackingLink {
  url: string;
  expiresAt: string;
}

export interface CustomerFeedback {
  rating: number;
  comment: string | null;
  submittedAt: string;
}

export interface CustomerRescheduleRequest {
  requestedWindowStart: string;
  requestedWindowEnd: string;
  notes: string | null;
  requestedAt: string;
}

export interface PublicTrackingData {
  reference: string;
  status: OrderStatus;
  customerName: string;
  destination: { address: string; region: string; lat: number; lng: number };
  driver: {
    name: string;
    vehiclePlate: string;
    lat: number | null;
    lng: number | null;
    locationUpdatedAt: string | null;
  } | null;
  distanceRemainingKm: number | null;
  estimatedArrivalMinutes: number | null;
  driverApproaching: boolean;
  timeline: Array<{ type: OrderEventType; occurredAt: string }>;
  proof: {
    confirmed: boolean;
    uploadedAt: string | null;
    recipientName: string | null;
    signatureCaptured: boolean;
  };
  feedback: CustomerFeedback | null;
  rescheduleRequest: CustomerRescheduleRequest | null;
  createdAt: string;
  deliveredAt: string | null;
  trackingExpiresAt: string;
}
