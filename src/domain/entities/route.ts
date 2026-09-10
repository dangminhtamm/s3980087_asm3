import type { OrderStatus } from './order.js';

export const ROUTE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

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

export interface Route {
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
  geometry: Array<[lat: number, lng: number]>;
  optimization: {
    provider: string;
    mode: 'AUTO' | 'MANUAL';
    optimizedAt: string;
    revision: number;
  };
  comparison: RouteComparison;
  stops: RouteStop[];
}

export interface CreateRouteInput {
  driverId: string;
  orderIds: string[];
  scheduledDate: string;
  optimize?: boolean | undefined;
}

export interface RouteItem extends Omit<Route, 'stops' | 'comparison'> {
  PK: string;
  SK: 'METADATA';
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
}

export interface RouteStopItem extends RouteStop {
  PK: string;
  SK: string;
}
