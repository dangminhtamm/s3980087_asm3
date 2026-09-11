import {
  ROUTE_STATUSES,
  type DeliveryRoute,
  type RouteComparison,
  type RouteStatus,
  type RouteStop,
} from '../../../packages/contracts/index.js';

export { ROUTE_STATUSES, type RouteComparison, type RouteStatus, type RouteStop };
export type Route = DeliveryRoute;

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
