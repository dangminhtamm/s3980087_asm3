/** Leaflet coordinate tuple in [latitude, longitude] order. */
export type MapCoordinate = [lat: number, lng: number];

export interface DeliveryMapProps {
  orderLocation: MapCoordinate;
  driverLocation?: MapCoordinate | null;
  routePath?: MapCoordinate[];
  address: string;
}
