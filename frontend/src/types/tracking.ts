import type { AdminOrderStatus, OrderEventType } from './admin';

export interface PublicTrackingData {
  reference: string;
  status: AdminOrderStatus;
  customerName: string;
  destination: {
    address: string;
    region: string;
    lat: number;
    lng: number;
  };
  driver: {
    name: string;
    vehiclePlate: string;
    lat: number | null;
    lng: number | null;
    locationUpdatedAt: string | null;
  } | null;
  distanceRemainingKm: number | null;
  estimatedArrivalMinutes: number | null;
  driverApproaching: boolean;
  timeline: Array<{ type: OrderEventType; occurredAt: string }>;
  proof: {
    confirmed: boolean;
    uploadedAt: string | null;
    recipientName: string | null;
    signatureCaptured: boolean;
  };
  feedback: CustomerFeedback | null;
  rescheduleRequest: CustomerRescheduleRequest | null;
  createdAt: string;
  deliveredAt: string | null;
  trackingExpiresAt: string;
}

export interface CustomerFeedback {
  rating: number;
  comment: string | null;
  submittedAt: string;
}

export interface CustomerRescheduleRequest {
  requestedWindowStart: string;
  requestedWindowEnd: string;
  notes: string | null;
  requestedAt: string;
}

export interface TrackingLink {
  url: string;
  expiresAt: string;
}
