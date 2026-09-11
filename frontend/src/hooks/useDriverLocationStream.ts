import { useEffect, useState } from 'react';

import { cloudFleetApi } from '../shared/api/http-client';
import type { ApiEnvelope } from '../types/order';
import type { DriverLocation } from '../types/admin';

interface RealtimeTicket {
  ticket: string;
  webSocketUrl: string;
  expiresAt: string;
}

interface LocationMessage {
  type: 'driver.location.updated';
  data: DriverLocation;
}

const isLocationMessage = (value: unknown): value is LocationMessage => {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<LocationMessage>;
  return (
    message.type === 'driver.location.updated' &&
    !!message.data &&
    typeof message.data.driverId === 'string' &&
    typeof message.data.lat === 'number' &&
    typeof message.data.lng === 'number'
  );
};

export const useDriverLocationStream = (
  onLocation: (location: DriverLocation) => void,
): 'connecting' | 'connected' | 'retrying' => {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'retrying'>('connecting');

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let retryTimer: number | null = null;

    const connect = async (): Promise<void> => {
      setStatus((current) => (current === 'connecting' ? 'connecting' : 'retrying'));
      try {
        const ticketResponse =
          await cloudFleetApi.post<ApiEnvelope<RealtimeTicket>>('/api/realtime/ticket');
        if (!active) return;
        const { ticket, webSocketUrl } = ticketResponse.data.data;
        socket = new WebSocket(`${webSocketUrl}?ticket=${encodeURIComponent(ticket)}`);
        socket.onopen = () => active && setStatus('connected');
        socket.onmessage = (event) => {
          try {
            const message: unknown = JSON.parse(String(event.data));
            if (isLocationMessage(message)) onLocation(message.data);
          } catch {
            // Ignore malformed or unrelated messages.
          }
        };
        socket.onclose = () => {
          if (active) {
            setStatus('retrying');
            retryTimer = window.setTimeout(() => void connect(), 5_000);
          }
        };
      } catch {
        if (active) {
          setStatus('retrying');
          retryTimer = window.setTimeout(() => void connect(), 10_000);
        }
      }
    };

    void connect();
    return () => {
      active = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [onLocation]);

  return status;
};
