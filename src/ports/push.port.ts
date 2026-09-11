import type { DriverPushPayload } from '../domain/entities/push.js';

export interface PushPort {
  notifyDriver(
    driverId: string,
    payload: DriverPushPayload,
  ): Promise<{ sent: number; configured: boolean }>;
}
