import type { AdminOrderStatus } from './admin';
import type { ApiEnvelope as SharedApiEnvelope } from '../../../packages/contracts/index.js';
export type { DeliveryProof, PresignedUpload } from '../../../packages/contracts/index.js';

export type DeliveryStatus = AdminOrderStatus;

export interface DeliveryOrder {
  orderId: string;
  customerName: string;
  dropoffAddress: string;
  region: string;
  lat: number;
  lng: number;
  status: DeliveryStatus;
  createdAt: string;
  deliveredAt: string | null;
  location: {
    lat: number;
    lng: number;
  };
}

export type ApiEnvelope<T> = SharedApiEnvelope<T>;
