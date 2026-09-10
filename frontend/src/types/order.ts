import type { AdminOrderStatus } from './admin';

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

export interface PresignedUpload {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
  requiredHeaders: Record<string, string>;
}

export interface DeliveryProof {
  orderId: string;
  objectKey: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  etag: string;
  uploadedBy: string;
  uploadedAt: string;
  recipientName: string | null;
  signatureDataUrl: string | null;
  barcode: string | null;
  notes: string | null;
  gps: { lat: number; lng: number; accuracy: number | null; recordedAt: string } | null;
}

export interface ApiEnvelope<T> {
  data: T;
}
