import {
  ORDER_EXCEPTION_REASONS,
  ORDER_STATUSES,
  UPDATABLE_ORDER_STATUSES,
  type CustomerRescheduleRequestDto,
  type OrderDto,
  type OrderExceptionDto,
  type OrderExceptionReason,
  type OrderStatus,
  type UpdatableOrderStatus,
} from '../../../packages/contracts/index.js';

export {
  ORDER_EXCEPTION_REASONS,
  ORDER_STATUSES,
  UPDATABLE_ORDER_STATUSES,
  type OrderExceptionReason,
  type OrderStatus,
  type UpdatableOrderStatus,
};

export type OrderException = OrderExceptionDto;

export type CustomerRescheduleRequest = CustomerRescheduleRequestDto;

export type Order = OrderDto;

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
