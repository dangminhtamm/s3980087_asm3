export const ORDER_STATUSES = [
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
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const UPDATABLE_ORDER_STATUSES = [
  'IN_PROGRESS',
  'ARRIVED',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RESCHEDULED',
  'CANCELLED',
  'RETURNING',
  'RETURNED',
] as const;

export type UpdatableOrderStatus =
  (typeof UPDATABLE_ORDER_STATUSES)[number];

export const ORDER_EXCEPTION_REASONS = [
  'CUSTOMER_UNAVAILABLE',
  'INVALID_ADDRESS',
  'CUSTOMER_REJECTED',
  'DAMAGED_PACKAGE',
  'VEHICLE_ISSUE',
  'WEATHER_OR_TRAFFIC',
  'DUPLICATE_ORDER',
  'CUSTOMER_CANCELLED',
  'OTHER',
] as const;

export type OrderExceptionReason = (typeof ORDER_EXCEPTION_REASONS)[number];

export interface OrderException {
  reason: OrderExceptionReason;
  notes: string | null;
  reportedAt: string;
  reportedBy: string;
}

export interface CustomerRescheduleRequest {
  requestedWindowStart: string;
  requestedWindowEnd: string;
  notes: string | null;
  requestedAt: string;
}

export interface Order {
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
  exception: OrderException | null;
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
  customerRescheduleRequest: CustomerRescheduleRequest | null;
}

export interface CreateOrderInput {
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  region: string;
  lat: number;
  lng: number;
  driverId?: string | null | undefined;
  timeWindowStart?: string | null | undefined;
  timeWindowEnd?: string | null | undefined;
  packageWeightKg?: number | undefined;
  packageVolumeM3?: number | undefined;
  serviceDurationMinutes?: number | undefined;
}

export interface UpdateOrderStatusInput {
  status: UpdatableOrderStatus;
  reason?: OrderExceptionReason | undefined;
  notes?: string | undefined;
}

/** DynamoDB representation of an order domain entity. */
export interface OrderItem extends Order {
  PK: string;
  SK: 'METADATA';
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK: string;
  GSI2SK: string;
}

export interface ListOrdersInput {
  status?: OrderStatus | undefined;
  driverId?: string | undefined;
  limit: number;
}
