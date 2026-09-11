import type {
  AdminOrder,
  AdminOrderStatus,
  CsvImportResult,
  DataResult,
  GeocodingCandidate,
  OrderEvent,
  OrderExceptionReason,
} from '../../../types/admin';
import type { ApiEnvelope } from '../../../types/order';
import type { TrackingLink } from '../../../types/tracking';
import {
  cacheDriverOrders,
  getCachedDriverOrders,
  queueMutation,
  updateCachedOrder,
} from '../../offline-sync';
import { fallbackOrThrow, isNetworkFailure } from '../../../shared/api/fallback';
import { cloudFleetApi } from '../../../shared/api/http-client';

export interface ListOrdersParams {
  status?: AdminOrderStatus;
  driverId?: string;
  limit?: number;
}

export const listOrders = async (params?: ListOrdersParams): Promise<DataResult<AdminOrder[]>> => {
  try {
    const response = await cloudFleetApi.get<ApiEnvelope<AdminOrder[]>>('/api/orders', { params });
    if (params?.driverId) await cacheDriverOrders(params.driverId, response.data.data);
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    if (params?.driverId && isNetworkFailure(error)) {
      const cached = await getCachedDriverOrders(params.driverId);
      if (cached.length > 0) return { data: cached, isFallback: true };
    }
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData
        .listOrders()
        .filter((order) => !params?.status || order.status === params.status)
        .filter((order) => !params?.driverId || order.driverId === params.driverId)
        .slice(0, params?.limit ?? 50),
    );
  }
};

export const getOrder = async (orderId: string): Promise<DataResult<AdminOrder>> => {
  try {
    const response = await cloudFleetApi.get<ApiEnvelope<AdminOrder>>(`/api/orders/${orderId}`);
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData.getOrder(orderId),
    );
  }
};

export const getOrderEvents = async (orderId: string): Promise<OrderEvent[]> => {
  const response = await cloudFleetApi.get<ApiEnvelope<OrderEvent[]>>(
    `/api/orders/${orderId}/events`,
  );
  return response.data.data;
};

export const getOrderTrackingLink = async (orderId: string): Promise<TrackingLink> => {
  const response = await cloudFleetApi.get<ApiEnvelope<TrackingLink>>(
    `/api/orders/${orderId}/tracking-link`,
  );
  return response.data.data;
};

type CreateOrderInput = Pick<
  AdminOrder,
  'customerName' | 'customerPhone' | 'dropoffAddress' | 'region' | 'lat' | 'lng'
> &
  Partial<
    Pick<
      AdminOrder,
      | 'timeWindowStart'
      | 'timeWindowEnd'
      | 'packageWeightKg'
      | 'packageVolumeM3'
      | 'serviceDurationMinutes'
    >
  > & { driverId?: string | null };

export const createOrder = async (input: CreateOrderInput): Promise<DataResult<AdminOrder>> => {
  try {
    const response = await cloudFleetApi.post<ApiEnvelope<AdminOrder>>('/api/orders', input);
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData.createOrder(input),
    );
  }
};

export const assignOrder = async (
  orderId: string,
  driverId: string,
): Promise<DataResult<AdminOrder>> => {
  try {
    const response = await cloudFleetApi.patch<ApiEnvelope<AdminOrder>>(
      `/api/orders/${orderId}/assign`,
      { driverId },
    );
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData.assignOrder(orderId, driverId),
    );
  }
};

export const updateOrderStatus = async (
  orderId: string,
  status: Exclude<AdminOrderStatus, 'PENDING' | 'ASSIGNED'>,
  exception?: { reason: OrderExceptionReason; notes?: string },
  offlineDriverId?: string,
): Promise<DataResult<AdminOrder>> => {
  try {
    const response = await cloudFleetApi.patch<ApiEnvelope<AdminOrder>>(
      `/api/orders/${orderId}/status`,
      { status, ...exception },
    );
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    if (offlineDriverId && isNetworkFailure(error)) {
      const current = (await getCachedDriverOrders(offlineDriverId)).find(
        (order) => order.orderId === orderId,
      );
      if (current) {
        const recordedAt = new Date().toISOString();
        const updated: AdminOrder = {
          ...current,
          status,
          deliveredAt: status === 'DELIVERED' ? recordedAt : current.deliveredAt,
          exception: exception
            ? {
                reason: exception.reason,
                notes: exception.notes ?? null,
                reportedAt: recordedAt,
                reportedBy: offlineDriverId,
              }
            : current.exception,
        };
        await queueMutation({
          method: 'PATCH',
          path: `/api/orders/${orderId}/status`,
          body: { status, ...exception },
          idempotencyKey: crypto.randomUUID(),
        });
        await updateCachedOrder(offlineDriverId, updated);
        return { data: updated, isFallback: true, isQueued: true };
      }
    }
    return fallbackOrThrow(error, async () =>
      (await import('../../dev/mock-data.adapter')).devMockData.updateStatus(
        orderId,
        status,
        exception,
      ),
    );
  }
};

export const importOrdersCsv = async (file: File): Promise<CsvImportResult> => {
  const response = await cloudFleetApi.post<ApiEnvelope<CsvImportResult>>(
    '/api/orders/import',
    file,
    {
      headers: { 'Content-Type': 'text/csv' },
      transformRequest: [(value) => value],
    },
  );
  return response.data.data;
};

export const exportOrdersCsv = async (): Promise<void> => {
  const response = await cloudFleetApi.get<Blob>('/api/orders/export.csv', {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cloudfleet-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

export const validateAddress = async (address: string): Promise<GeocodingCandidate[]> => {
  const response = await cloudFleetApi.post<
    ApiEnvelope<{ valid: boolean; candidates: GeocodingCandidate[] }>
  >('/api/geocoding/validate', { address, countryCode: 'vn', limit: 3 });
  return response.data.data.candidates;
};
