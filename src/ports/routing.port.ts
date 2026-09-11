import type { Order } from '../domain/entities/order.js';

export interface RoutingPoint {
  lat: number;
  lng: number;
}

export interface RoutePlanStop {
  orderId: string;
  sequence: number;
  plannedArrivalAt: string;
  plannedDepartureAt: string;
  plannedTravelDurationSeconds: number;
  plannedDistanceMeters: number;
}

export interface RoutePlan {
  stops: RoutePlanStop[];
  plannedDistanceMeters: number;
  plannedDurationSeconds: number;
  geometry: Array<[number, number]>;
  provider: string;
}

export interface RoutingPort {
  plan(
    origin: RoutingPoint,
    orders: Order[],
    departureAt: string,
    manualOrderIds?: string[],
  ): Promise<RoutePlan>;
}
