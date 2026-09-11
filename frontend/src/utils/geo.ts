import type { MapCoordinate } from '../types/map';

const EARTH_RADIUS_KM = 6_371;
const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

/** Calculates straight-line distance between two WGS84 coordinates. */
export const haversineDistanceKm = (from: MapCoordinate, to: MapCoordinate): number => {
  const [fromLat, fromLng] = from;
  const [toLat, toLng] = to;
  const latitudeDelta = toRadians(toLat - fromLat);
  const longitudeDelta = toRadians(toLng - fromLng);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

export const formatDistance = (distanceKm: number): string =>
  distanceKm < 1 ? `${Math.round(distanceKm * 1_000)} m` : `${distanceKm.toFixed(1)} km`;

export const formatLocationFreshness = (timestamp: string | null): string => {
  if (!timestamp) return 'Location unavailable';
  const elapsedMs = Math.max(0, Date.now() - new Date(timestamp).getTime());
  const minutes = Math.round(elapsedMs / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days > 30 ? 'Updated over 30 days ago' : `Updated ${days} day${days === 1 ? '' : 's'} ago`;
};
