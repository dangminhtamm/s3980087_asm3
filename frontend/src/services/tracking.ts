import type { ApiEnvelope } from '../types/order';
import type {
  CustomerFeedback,
  CustomerRescheduleRequest,
  PublicTrackingData,
} from '../types/tracking';
import { cloudFleetApi } from './api';

export const getPublicTracking = async (trackingToken: string): Promise<PublicTrackingData> => {
  const response = await cloudFleetApi.get<ApiEnvelope<PublicTrackingData>>(
    `/api/tracking/${encodeURIComponent(trackingToken)}`,
  );
  return response.data.data;
};

export const submitCustomerFeedback = async (
  trackingToken: string,
  input: { rating: number; comment?: string },
): Promise<CustomerFeedback> => {
  const response = await cloudFleetApi.post<ApiEnvelope<CustomerFeedback>>(
    `/api/tracking/${encodeURIComponent(trackingToken)}/feedback`,
    input,
  );
  return response.data.data;
};

export const requestCustomerReschedule = async (
  trackingToken: string,
  input: { requestedWindowStart: string; requestedWindowEnd: string; notes?: string },
): Promise<CustomerRescheduleRequest> => {
  const response = await cloudFleetApi.post<ApiEnvelope<CustomerRescheduleRequest>>(
    `/api/tracking/${encodeURIComponent(trackingToken)}/reschedule`,
    input,
  );
  return response.data.data;
};
