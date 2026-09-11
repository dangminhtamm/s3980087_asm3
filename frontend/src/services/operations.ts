import axios from 'axios';

import type {
  AdminOrder,
  AdminOrderStatus,
  OrderExceptionReason,
  DataResult,
  DriverLocation,
  DriverStatus,
  FleetDriver,
  AnalyticsOverviewData,
  AnalyticsRun,
  OrderEvent,
  ProofViewUrl,
  DeliveryRoute,
  GeocodingCandidate,
  CsvImportResult,
  OperationalIssue,
} from '../types/admin';
import type { ApiEnvelope, DeliveryProof } from '../types/order';
import type { TrackingLink } from '../types/tracking';
import { runtimeEnv } from '../config/runtime';
import { cloudFleetApi } from './api';
import {
  cacheDriverOrders,
  getCachedDriverOrders,
  queueMutation,
  updateCachedOrder,
} from './offline-store';

const mockFallbackEnabled = runtimeEnv('VITE_ENABLE_MOCK_FALLBACK') === 'true';

let mockOrders: AdminOrder[] = [
  {
    orderId: '0fe1212c-930a-47af-93a7-480ca0a3e771',
    customerName: 'Nguyễn Minh Anh',
    customerPhone: '+84901234567',
    dropoffAddress: '72 Nguyen Hue Street, District 1, Ho Chi Minh City',
    region: 'District 1',
    lat: 10.77428,
    lng: 106.70391,
    status: 'IN_PROGRESS',
    driverId: 'DRV-018',
    createdAt: '2026-08-24T02:45:00.000Z',
    deliveredAt: null,
    exception: null,
  },
  {
    orderId: '0c8e3c60-05b1-46de-a947-79aa26e67075',
    customerName: 'Trần Lan Anh',
    customerPhone: '+84912345678',
    dropoffAddress: '15 Vo Van Tan Street, District 3, Ho Chi Minh City',
    region: 'District 3',
    lat: 10.77712,
    lng: 106.68842,
    status: 'PENDING',
    driverId: null,
    createdAt: '2026-08-24T03:20:00.000Z',
    deliveredAt: null,
    exception: null,
  },
  {
    orderId: 'edccbd70-71f7-4b05-b2b5-dab54fb596d4',
    customerName: 'Lê Khánh Linh',
    customerPhone: '+84923456789',
    dropoffAddress: '82 Dien Bien Phu Street, Binh Thanh District, Ho Chi Minh City',
    region: 'Binh Thanh',
    lat: 10.80122,
    lng: 106.71014,
    status: 'PENDING',
    driverId: null,
    createdAt: '2026-08-24T03:10:00.000Z',
    deliveredAt: null,
    exception: null,
  },
  {
    orderId: '20dcfe10-c53c-4d87-b521-23b75ceaff71',
    customerName: 'Phạm Tuấn Kiệt',
    customerPhone: '+84934567890',
    dropoffAddress: '21 Mai Chi Tho Street, Thu Duc City, Ho Chi Minh City',
    region: 'Thu Duc',
    lat: 10.78752,
    lng: 106.74915,
    status: 'ASSIGNED',
    driverId: 'DRV-026',
    createdAt: '2026-08-24T02:55:00.000Z',
    deliveredAt: null,
    exception: null,
  },
  {
    orderId: 'f2d6e07d-a558-4026-9f2d-6fa637e097d3',
    customerName: 'Đỗ Bảo Ngọc',
    customerPhone: '+84945678901',
    dropoffAddress: '119 Lam Van Ben Street, District 7, Ho Chi Minh City',
    region: 'District 7',
    lat: 10.7391,
    lng: 106.7131,
    status: 'DELIVERED',
    driverId: 'DRV-011',
    createdAt: '2026-08-24T01:32:00.000Z',
    deliveredAt: '2026-08-24T02:06:00.000Z',
    exception: null,
  },
  {
    orderId: '62fcb4ad-1079-437b-a837-87dd2a7ea113',
    customerName: 'Vũ Quốc Bảo',
    customerPhone: '+84956789012',
    dropoffAddress: '82 Nguyen Van Troi Street, Phu Nhuan District, Ho Chi Minh City',
    region: 'Phu Nhuan',
    lat: 10.7962,
    lng: 106.6732,
    status: 'DELIVERED',
    driverId: 'DRV-018',
    createdAt: '2026-08-24T01:10:00.000Z',
    deliveredAt: '2026-08-24T01:48:00.000Z',
    exception: null,
  },
  {
    orderId: 'b5a314f0-bba4-4eaf-b88b-cdb4479632fb',
    customerName: 'Mai Thu Hà',
    customerPhone: '+84967890123',
    dropoffAddress: '2 Le Duan Boulevard, District 1, Ho Chi Minh City',
    region: 'District 1',
    lat: 10.78191,
    lng: 106.69925,
    status: 'ASSIGNED',
    driverId: 'DRV-018',
    createdAt: '2026-09-10T00:45:00.000Z',
    deliveredAt: null,
    exception: null,
  },
];

let mockDrivers: FleetDriver[] = [
  {
    driverId: 'DRV-018',
    name: 'Minh Duy',
    phone: '+84901110018',
    vehiclePlate: '51A-482.17',
    currentArea: 'District 1',
    status: 'ON_DELIVERY',
    completedToday: 8,
    lat: 10.7738,
    lng: 106.7018,
    locationUpdatedAt: '2026-08-24T03:12:00.000Z',
    updatedAt: '2026-08-24T03:12:00.000Z',
  },
  {
    driverId: 'DRV-026',
    name: 'Hải Nam',
    phone: '+84901110026',
    vehiclePlate: '59C-318.42',
    currentArea: 'Thu Duc',
    status: 'ON_DELIVERY',
    completedToday: 6,
    lat: 10.7881,
    lng: 106.7461,
    locationUpdatedAt: '2026-08-24T03:08:00.000Z',
    updatedAt: '2026-08-24T03:08:00.000Z',
  },
  {
    driverId: 'DRV-011',
    name: 'Thanh An',
    phone: '+84901110011',
    vehiclePlate: '50H-921.06',
    currentArea: 'District 7',
    status: 'AVAILABLE',
    completedToday: 7,
    lat: 10.7398,
    lng: 106.7122,
    locationUpdatedAt: '2026-08-24T03:02:00.000Z',
    updatedAt: '2026-08-24T03:02:00.000Z',
  },
  {
    driverId: 'DRV-032',
    name: 'Hoàng Sơn',
    phone: '+84901110032',
    vehiclePlate: '51D-104.38',
    currentArea: 'Binh Thanh',
    status: 'OFFLINE',
    completedToday: 0,
    lat: null,
    lng: null,
    locationUpdatedAt: null,
    updatedAt: '2026-08-24T01:14:00.000Z',
  },
];

const canUseFallback = (error: unknown): boolean => {
  if (!mockFallbackEnabled || !axios.isAxiosError(error)) return false;
  return !error.response || error.response.status >= 500 || error.response.status === 404;
};

const isNetworkFailure = (error: unknown): boolean => axios.isAxiosError(error) && !error.response;

const fallbackOrThrow = <T>(error: unknown, fallback: () => T): DataResult<T> => {
  if (!canUseFallback(error)) throw error;
  return { data: fallback(), isFallback: true };
};

export const listOrders = async (params?: {
  status?: AdminOrderStatus;
  driverId?: string;
  limit?: number;
}): Promise<DataResult<AdminOrder[]>> => {
  try {
    const response = await cloudFleetApi.get<ApiEnvelope<AdminOrder[]>>('/api/orders', { params });
    if (params?.driverId) await cacheDriverOrders(params.driverId, response.data.data);
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    if (params?.driverId && isNetworkFailure(error)) {
      const cached = await getCachedDriverOrders(params.driverId);
      if (cached.length > 0) return { data: cached, isFallback: true };
    }
    return fallbackOrThrow(error, () =>
      mockOrders
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
    return fallbackOrThrow(
      error,
      () => mockOrders.find((order) => order.orderId === orderId) ?? mockOrders[0]!,
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

export const getDeliveryProof = async (orderId: string): Promise<DeliveryProof> => {
  const response = await cloudFleetApi.get<ApiEnvelope<DeliveryProof>>(
    `/api/orders/${orderId}/proof`,
  );
  return response.data.data;
};

export const getDeliveryProofViewUrl = async (orderId: string): Promise<ProofViewUrl> => {
  const response = await cloudFleetApi.get<ApiEnvelope<ProofViewUrl>>(
    `/api/orders/${orderId}/proof/view-url`,
  );
  return response.data.data;
};

export const createOrder = async (
  input: Pick<
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
    > & { driverId?: string | null },
): Promise<DataResult<AdminOrder>> => {
  try {
    const response = await cloudFleetApi.post<ApiEnvelope<AdminOrder>>('/api/orders', input);
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, () => {
      const order: AdminOrder = {
        orderId: crypto.randomUUID(),
        ...input,
        driverId: input.driverId ?? null,
        status: input.driverId ? 'ASSIGNED' : 'PENDING',
        createdAt: new Date().toISOString(),
        deliveredAt: null,
        exception: null,
      };
      mockOrders = [order, ...mockOrders];
      return order;
    });
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
    return fallbackOrThrow(error, () => {
      const index = mockOrders.findIndex((order) => order.orderId === orderId);
      const current = mockOrders[index];
      if (!current) throw new Error('Mock order not found');
      const updated: AdminOrder = { ...current, driverId, status: 'ASSIGNED', exception: null };
      mockOrders = mockOrders.map((order) => (order.orderId === orderId ? updated : order));
      mockDrivers = mockDrivers.map((driver) =>
        driver.driverId === driverId
          ? { ...driver, status: 'ON_DELIVERY', updatedAt: new Date().toISOString() }
          : driver,
      );
      return updated;
    });
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
      const cached = await getCachedDriverOrders(offlineDriverId);
      const current = cached.find((order) => order.orderId === orderId);
      if (current) {
        const now = new Date().toISOString();
        const updated: AdminOrder = {
          ...current,
          status,
          deliveredAt: status === 'DELIVERED' ? now : current.deliveredAt,
          exception: exception
            ? {
                reason: exception.reason,
                notes: exception.notes ?? null,
                reportedAt: now,
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
    return fallbackOrThrow(error, () => {
      const current = mockOrders.find((order) => order.orderId === orderId);
      if (!current) throw new Error('Mock order not found');
      const now = new Date().toISOString();
      const updated: AdminOrder = {
        ...current,
        status,
        deliveredAt: status === 'DELIVERED' ? now : current.deliveredAt,
        exception: exception
          ? {
              reason: exception.reason,
              notes: exception.notes ?? null,
              reportedAt: now,
              reportedBy: 'mock-user',
            }
          : current.exception,
      };
      mockOrders = mockOrders.map((order) => (order.orderId === orderId ? updated : order));
      if (status === 'DELIVERED' && current.driverId) {
        mockDrivers = mockDrivers.map((driver) =>
          driver.driverId === current.driverId
            ? {
                ...driver,
                status: 'AVAILABLE',
                completedToday: driver.completedToday + 1,
                updatedAt: new Date().toISOString(),
              }
            : driver,
        );
      }
      return updated;
    });
  }
};

export const listDrivers = async (status?: DriverStatus): Promise<DataResult<FleetDriver[]>> => {
  try {
    const response = await cloudFleetApi.get<ApiEnvelope<FleetDriver[]>>('/api/drivers', {
      params: { status },
    });
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, () =>
      mockDrivers.filter((driver) => !status || driver.status === status),
    );
  }
};

export const getDriver = async (driverId: string): Promise<DataResult<FleetDriver>> => {
  try {
    const response = await cloudFleetApi.get<ApiEnvelope<FleetDriver>>(`/api/drivers/${driverId}`);
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(
      error,
      () => mockDrivers.find((driver) => driver.driverId === driverId) ?? mockDrivers[0]!,
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
    return fallbackOrThrow(error, () => {
      const driver: FleetDriver = {
        driverId: `DRV-${String(mockDrivers.length + 40).padStart(3, '0')}`,
        ...input,
        status: 'AVAILABLE',
        completedToday: 0,
        lat: null,
        lng: null,
        locationUpdatedAt: null,
        updatedAt: new Date().toISOString(),
      };
      mockDrivers = [driver, ...mockDrivers];
      return driver;
    });
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

export const createRoute = async (input: {
  driverId: string;
  orderIds: string[];
  scheduledDate: string;
}): Promise<DeliveryRoute> => {
  const response = await cloudFleetApi.post<ApiEnvelope<DeliveryRoute>>('/api/routes', input);
  return response.data.data;
};

export const listRoutes = async (params?: {
  driverId?: string;
  limit?: number;
}): Promise<DeliveryRoute[]> => {
  const response = await cloudFleetApi.get<ApiEnvelope<DeliveryRoute[]>>('/api/routes', { params });
  return response.data.data;
};

export const getRoute = async (routeId: string): Promise<DeliveryRoute> => {
  const response = await cloudFleetApi.get<ApiEnvelope<DeliveryRoute>>(`/api/routes/${routeId}`);
  return response.data.data;
};

export const reorderRoute = async (routeId: string, orderIds: string[]): Promise<DeliveryRoute> => {
  const response = await cloudFleetApi.patch<ApiEnvelope<DeliveryRoute>>(
    `/api/routes/${routeId}/reorder`,
    { orderIds },
  );
  return response.data.data;
};

export const reoptimizeRoute = async (routeId: string): Promise<DeliveryRoute> => {
  const response = await cloudFleetApi.post<ApiEnvelope<DeliveryRoute>>(
    `/api/routes/${routeId}/re-optimize`,
    {},
  );
  return response.data.data;
};

export const listOperationalIssues = async (limit = 100): Promise<OperationalIssue[]> => {
  const response = await cloudFleetApi.get<ApiEnvelope<OperationalIssue[]>>(
    '/api/operations/issues',
    { params: { limit } },
  );
  return response.data.data;
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
    return fallbackOrThrow(error, () => {
      const current = mockDrivers.find((driver) => driver.driverId === driverId);
      if (!current) throw new Error('Mock driver not found');
      const updated = { ...current, status, updatedAt: new Date().toISOString() };
      mockDrivers = mockDrivers.map((driver) => (driver.driverId === driverId ? updated : driver));
      return updated;
    });
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
    if (isNetworkFailure(error)) {
      await queueMutation({
        method: 'PATCH',
        path: `/api/drivers/${driverId}/location`,
        body: input,
        idempotencyKey: crypto.randomUUID(),
      });
      return {
        data: {
          driverId,
          lat: input.lat,
          lng: input.lng,
          accuracy: input.accuracy ?? null,
          recordedAt: input.recordedAt ?? new Date().toISOString(),
        },
        isFallback: true,
        isQueued: true,
      };
    }
    return fallbackOrThrow(error, () => ({
      driverId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? null,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    }));
  }
};

const buildFallbackAnalytics = (params?: {
  from?: string;
  to?: string;
  region?: string;
}): AnalyticsOverviewData => {
  const to = params?.to ?? new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(`${to}T00:00:00.000Z`);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const from = params?.from ?? defaultFrom.toISOString().slice(0, 10);
  const days = Math.max(
    1,
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1,
  );
  const profiles = [
    {
      region: 'District 1',
      daily: 22,
      successRate: 97.4,
      averageDeliveryMinutes: 29,
      isAbnormal: false,
    },
    {
      region: 'District 3',
      daily: 18,
      successRate: 96.2,
      averageDeliveryMinutes: 33,
      isAbnormal: false,
    },
    {
      region: 'District 7',
      daily: 17,
      successRate: 96.9,
      averageDeliveryMinutes: 36,
      isAbnormal: false,
    },
    {
      region: 'Binh Thanh',
      daily: 21,
      successRate: 94.8,
      averageDeliveryMinutes: 39,
      isAbnormal: false,
    },
    {
      region: 'Thu Duc',
      daily: 24,
      successRate: 88.6,
      averageDeliveryMinutes: 52,
      isAbnormal: true,
    },
  ];
  const regions = profiles
    .map((profile, index) => {
      const orderCount = profile.daily * days;
      return {
        region: profile.region,
        orderCount,
        deliveredOrders: Math.round((orderCount * profile.successRate) / 100),
        successRate: profile.successRate,
        averageDeliveryMinutes: profile.averageDeliveryMinutes,
        rankBySpeed: index + 1,
        isAbnormal: profile.isAbnormal,
      };
    })
    .sort((left, right) => left.averageDeliveryMinutes - right.averageDeliveryMinutes)
    .map((region, index) => ({ ...region, rankBySpeed: index + 1 }));
  const selected = params?.region
    ? regions.find((region) => region.region === params.region)
    : null;
  const totalOrders =
    selected?.orderCount ?? regions.reduce((sum, region) => sum + region.orderCount, 0);
  const deliveredOrders =
    selected?.deliveredOrders ?? regions.reduce((sum, region) => sum + region.deliveredOrders, 0);
  const averageDeliveryMinutes = selected?.averageDeliveryMinutes ?? 38;
  const successRate =
    totalOrders === 0 ? 0 : Math.round((deliveredOrders / totalOrders) * 10_000) / 100;
  const deliveryVolumeTrend = Array.from({ length: days }, (_, index) => {
    const date = new Date(`${from}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    const wave = 0.84 + Math.sin(index * 0.72) * 0.13 + (index / Math.max(1, days)) * 0.18;
    const orderCount = Math.max(1, Math.round((totalOrders / days) * wave));
    return {
      date: date.toISOString().slice(0, 10),
      orderCount,
      deliveredOrders: Math.round((orderCount * successRate) / 100),
    };
  });
  const previousTotal = Math.round(totalOrders / 1.064);
  const previousDelivered = Math.round(deliveredOrders / 1.071);
  const previousAverage = Math.round(averageDeliveryMinutes * 1.058 * 100) / 100;
  const previousToDate = new Date(`${from}T00:00:00.000Z`);
  previousToDate.setUTCDate(previousToDate.getUTCDate() - 1);
  const previousFromDate = new Date(previousToDate);
  previousFromDate.setUTCDate(previousFromDate.getUTCDate() - days + 1);

  return {
    generatedAt: new Date().toISOString(),
    coverage: { from: '2026-01-01', to },
    period: { from, to },
    selectedRegion: params?.region ?? null,
    totalOrders,
    deliveredOrders,
    successRate,
    averageDeliveryMinutes,
    comparison: {
      previousPeriod: {
        from: previousFromDate.toISOString().slice(0, 10),
        to: previousToDate.toISOString().slice(0, 10),
      },
      previous: {
        totalOrders: previousTotal,
        deliveredOrders: previousDelivered,
        successRate: previousTotal
          ? Math.round((previousDelivered / previousTotal) * 10_000) / 100
          : 0,
        averageDeliveryMinutes: previousAverage,
      },
      totalOrdersChangePercent: 6.4,
      deliveredOrdersChangePercent: 7.1,
      successRateChangePoints: 0.6,
      averageDeliveryMinutesChangePercent: -5.5,
    },
    deliveryVolumeTrend,
    hourlyOrderVolume: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orderCount: Math.round(
        totalOrders *
          ([
            0.004, 0.002, 0.002, 0.002, 0.003, 0.006, 0.012, 0.025, 0.055, 0.08, 0.09, 0.085, 0.07,
            0.075, 0.09, 0.1, 0.11, 0.105, 0.075, 0.045, 0.025, 0.015, 0.01, 0.007,
          ][hour] ?? 0),
      ),
    })),
    regions,
  };
};

export const getAnalyticsOverview = async (params?: {
  from?: string;
  to?: string;
  region?: string;
}): Promise<DataResult<AnalyticsOverviewData>> => {
  try {
    const response = await cloudFleetApi.get<ApiEnvelope<AnalyticsOverviewData>>(
      '/api/analytics/overview',
      { params },
    );
    return { data: response.data.data, isFallback: false };
  } catch (error: unknown) {
    return fallbackOrThrow(error, () => buildFallbackAnalytics(params));
  }
};

/** Starts the AWS Step Functions workflow; intentionally has no mock fallback. */
export const startAnalyticsRun = async (): Promise<AnalyticsRun> => {
  const response = await cloudFleetApi.post<ApiEnvelope<AnalyticsRun>>('/api/analytics/runs');
  return response.data.data;
};

/** Reads the durable Step Functions execution status for dashboard polling. */
export const getAnalyticsRun = async (runId: string): Promise<AnalyticsRun> => {
  const response = await cloudFleetApi.get<ApiEnvelope<AnalyticsRun>>(
    `/api/analytics/runs/${encodeURIComponent(runId)}`,
  );
  return response.data.data;
};
