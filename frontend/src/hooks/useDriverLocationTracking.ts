import { useCallback, useEffect, useRef, useState } from 'react';

import { updateDriverLocation } from '../features/drivers/api/drivers.client';

export type TrackingStatus =
  'idle' | 'requesting' | 'tracking' | 'denied' | 'unsupported' | 'error';

interface TrackedLocation {
  lat: number;
  lng: number;
  accuracy: number;
  recordedAt: string;
}

export interface DriverLocationTracking {
  status: TrackingStatus;
  lastUpdatedAt: string | null;
  lastLocation: TrackedLocation | null;
  retry: () => void;
}

const MIN_UPDATE_INTERVAL_MS = 10_000;

export const useDriverLocationTracking = (
  driverId: string,
  enabled: boolean,
): DriverLocationTracking => {
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [lastLocation, setLastLocation] = useState<TrackedLocation | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const lastSentAt = useRef(0);

  const retry = useCallback(() => {
    lastSentAt.current = 0;
    setRetryToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return;
    }
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }

    let active = true;
    setStatus('requesting');
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (!active || now - lastSentAt.current < MIN_UPDATE_INTERVAL_MS) return;
        lastSentAt.current = now;
        const recordedAt = new Date(position.timestamp).toISOString();
        const currentLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          recordedAt,
        };

        void updateDriverLocation(driverId, {
          ...currentLocation,
          accuracy: position.coords.accuracy,
          recordedAt,
        })
          .then(() => {
            if (active) {
              setStatus('tracking');
              setLastUpdatedAt(recordedAt);
              setLastLocation(currentLocation);
            }
          })
          .catch(() => active && setStatus('error'));
      },
      (error) => {
        if (active) setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'error');
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 },
    );

    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [driverId, enabled, retryToken]);

  return { status, lastUpdatedAt, lastLocation, retry };
};
