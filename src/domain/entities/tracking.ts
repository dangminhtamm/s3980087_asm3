import type { OrderEventType } from './order-event.js';
import type { OrderStatus } from './order.js';

export interface TrackingLink {
  url: string;
  expiresAt: string;
}

export interface PublicTrackingTimelineEvent {
  type: OrderEventType;
  occurredAt: string;
}

export interface PublicTrackingResponse {
  reference: string;
  status: OrderStatus;
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
  timeline: PublicTrackingTimelineEvent[];
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
