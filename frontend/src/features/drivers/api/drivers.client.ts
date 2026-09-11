import type { ApiEnvelope } from '../../../types/order';
import type { DataResult, DriverLocation, DriverStatus, FleetDriver } from '../../../types/admin';
import { queueMutation } from '../../offline-sync';
import { fallbackOrThrow, isNetworkFailure } from '../../../shared/api/fallback';
import { cloudFleetApi } from '../../../shared/api/http-client';

export const listDrivers = async (status?: DriverStatus): Promise<DataResult<FleetDriver[]>> => {
  try {
    const response = await cloudFleetApi.get<ApiEnvelope<FleetDriver[]>>('/api/drivers', {
      params: { status },
    });
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData.listDrivers(status),
    );
  }
};

export const getDriver = async (driverId: string): Promise<DataResult<FleetDriver>> => {
  try {
    const response = await cloudFleetApi.get<ApiEnvelope<FleetDriver>>(`/api/drivers/${driverId}`);
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData.getDriver(driverId),
    );
  }
};

export const createDriver = async (
  input: Pick<FleetDriver, 'name' | 'phone' | 'vehiclePlate' | 'currentArea'> &
    Partial<Pick<FleetDriver, 'maxWeightKg' | 'maxVolumeM3'>>,
): Promise<DataResult<FleetDriver>> => {
  try {
    const response = await cloudFleetApi.post<ApiEnvelope<FleetDriver>>('/api/drivers', input);
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData.createDriver(input),
    );
  }
};

export const updateDriverStatus = async (
  driverId: string,
  status: DriverStatus,
): Promise<DataResult<FleetDriver>> => {
  try {
    const response = await cloudFleetApi.patch<ApiEnvelope<FleetDriver>>(
      `/api/drivers/${driverId}/status`,
      { status },
    );
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData.updateDriverStatus(
        driverId,
        status,
      ),
    );
  }
};

export const updateDriverLocation = async (
  driverId: string,
  input: { lat: number; lng: number; accuracy?: number; recordedAt?: string },
): Promise<DataResult<DriverLocation>> => {
  try {
    const response = await cloudFleetApi.patch<ApiEnvelope<DriverLocation>>(
      `/api/drivers/${driverId}/location`,
      input,
    );
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    const data: DriverLocation = {
      driverId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? null,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    };
    if (isNetworkFailure(error)) {
      await queueMutation({
        method: 'PATCH',
        path: `/api/drivers/${driverId}/location`,
        body: input,
        idempotencyKey: crypto.randomUUID(),
      });
      return { data, isFallback: true, isQueued: true };
    }
    return fallbackOrThrow(error, () => data);
  }
};
