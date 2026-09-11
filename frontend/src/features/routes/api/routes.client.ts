import { cloudFleetApi } from '../../../shared/api/http-client';
import type { DeliveryRoute } from '../../../types/admin';
import type { ApiEnvelope } from '../../../types/order';

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
