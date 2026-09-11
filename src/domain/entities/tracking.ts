import type {
  CustomerFeedback,
  CustomerRescheduleRequest,
  PublicTrackingData,
  TrackingLink,
} from '../../../packages/contracts/index.js';

export type PublicTrackingTimelineEvent = PublicTrackingData['timeline'][number];
export type PublicTrackingResponse = PublicTrackingData;
export type { CustomerFeedback, CustomerRescheduleRequest, TrackingLink };
