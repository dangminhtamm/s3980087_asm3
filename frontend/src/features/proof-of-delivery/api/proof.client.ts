import { cloudFleetApi } from '../../../shared/api/http-client';
import type { ProofViewUrl } from '../../../types/admin';
import type { ApiEnvelope, DeliveryProof } from '../../../types/order';

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
