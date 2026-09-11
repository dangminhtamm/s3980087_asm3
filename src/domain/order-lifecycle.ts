import type { OrderStatus, UpdatableOrderStatus } from './entities/order.js';

const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ARRIVED', 'DELIVERY_FAILED', 'CANCELLED'],
  ARRIVED: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED: ['RESCHEDULED', 'RETURNING'],
  RESCHEDULED: ['ASSIGNED', 'CANCELLED'],
  CANCELLED: [],
  RETURNING: ['RETURNED'],
  RETURNED: [],
  DELIVERED: [],
};

export const canTransitionOrder = (current: OrderStatus, next: OrderStatus): boolean =>
  transitions[current].includes(next);

export const allowedOrderTransitions = (current: OrderStatus): readonly OrderStatus[] =>
  transitions[current];

export const isExceptionStatus = (status: UpdatableOrderStatus): boolean =>
  status === 'DELIVERY_FAILED' || status === 'CANCELLED';

export const releasesDriver = (status: UpdatableOrderStatus): boolean =>
  status === 'DELIVERED' ||
  status === 'RESCHEDULED' ||
  status === 'CANCELLED' ||
  status === 'RETURNED';
