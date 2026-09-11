import type { Order, OrderStatus } from '../../domain/entities/order.js';
import type { Route } from '../../domain/entities/route.js';

const padSequence = (sequence: number): string => String(sequence).padStart(3, '0');

export const DynamoKeys = {
  prefixes: {
    event: 'EVENT#',
    push: 'PUSH#',
    route: 'ROUTE#',
    stop: 'STOP#',
  },
  orderPk: (orderId: string): string => `ORDER#${orderId}`,
  driverPk: (driverId: string): string => `DRIVER#${driverId}`,
  routePk: (routeId: string): string => `ROUTE#${routeId}`,
  trackingPk: (tokenHash: string): string => `TRACKING#${tokenHash}`,

  orderMetadata: (orderId: string) =>
    ({ PK: DynamoKeys.orderPk(orderId), SK: 'METADATA' }) as const,
  orderProof: (orderId: string) => ({ PK: DynamoKeys.orderPk(orderId), SK: 'PROOF#POD' }) as const,
  orderTrackingToken: (orderId: string) =>
    ({
      PK: DynamoKeys.orderPk(orderId),
      SK: 'TRACKING#TOKEN',
    }) as const,
  orderFeedback: (orderId: string) =>
    ({ PK: DynamoKeys.orderPk(orderId), SK: 'CUSTOMER#FEEDBACK' }) as const,
  driverProfile: (driverId: string) =>
    ({ PK: DynamoKeys.driverPk(driverId), SK: 'PROFILE' }) as const,
  driverPush: (driverId: string, subscriptionId: string) => ({
    PK: DynamoKeys.driverPk(driverId),
    SK: `PUSH#${subscriptionId}`,
  }),
  driverLocation: (driverId: string, recordedAt: string, locationId: string) => ({
    PK: DynamoKeys.driverPk(driverId),
    SK: `LOCATION#${recordedAt}#${locationId}`,
  }),
  routeMetadata: (routeId: string) =>
    ({ PK: DynamoKeys.routePk(routeId), SK: 'METADATA' }) as const,
  routeStopSk: (sequence: number, orderId: string): string =>
    `STOP#${padSequence(sequence)}#ORDER#${orderId}`,
  routeStop: (routeId: string, sequence: number, orderId: string) =>
    ({
      PK: DynamoKeys.routePk(routeId),
      SK: DynamoKeys.routeStopSk(sequence, orderId),
    }) as const,
  trackingToken: (tokenHash: string) =>
    ({ PK: DynamoKeys.trackingPk(tokenHash), SK: 'TOKEN' }) as const,

  orderStatusPk: (status: OrderStatus): string => `ORDER_STATUS#${status}`,
  orderCreatedSk: (order: Pick<Order, 'createdAt' | 'orderId'>): string =>
    `CREATED#${order.createdAt}#ORDER#${order.orderId}`,
  driverOrderSk: (order: Pick<Order, 'status' | 'createdAt' | 'orderId'>): string =>
    `STATUS#${order.status}#CREATED#${order.createdAt}#ORDER#${order.orderId}`,
  driverStatusPk: (status: string): string => `DRIVER_STATUS#${status}`,
  driverUpdatedSk: (driverId: string, updatedAt: string): string =>
    `UPDATED#${updatedAt}#DRIVER#${driverId}`,
  routeStatusPk: (status: string): string => `ROUTE_STATUS#${status}`,
  driverRouteSk: (route: Pick<Route, 'scheduledDate' | 'createdAt' | 'routeId'>): string =>
    `ROUTE#${route.scheduledDate}#CREATED#${route.createdAt}#${route.routeId}`,
  routeStatusSk: (route: Pick<Route, 'scheduledDate' | 'createdAt' | 'routeId'>): string =>
    `DATE#${route.scheduledDate}#CREATED#${route.createdAt}#ROUTE#${route.routeId}`,
  orderEventSk: (occurredAt: string, eventId: string): string => `EVENT#${occurredAt}#${eventId}`,
} as const;
