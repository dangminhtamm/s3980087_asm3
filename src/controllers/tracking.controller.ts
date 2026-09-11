import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendData } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type {
  customerFeedbackSchema,
  customerRescheduleSchema,
  trackingTokenParamsSchema,
} from '../schemas/tracking.schema.js';
import type { TrackingService } from '../services/tracking.service.js';

type TrackingParams = z.infer<typeof trackingTokenParamsSchema>;
type FeedbackBody = z.infer<typeof customerFeedbackSchema>;
type RescheduleBody = z.infer<typeof customerRescheduleSchema>;

export class TrackingController {
  public constructor(private readonly tracking: TrackingService) {}

  public get = async (_request: Request, response: Response): Promise<void> => {
    const { trackingToken } = validated<TrackingParams>(response, 'params');
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Pragma', 'no-cache');
    sendData(response, 200, await this.tracking.getTracking(trackingToken));
  };

  public submitFeedback = async (_request: Request, response: Response): Promise<void> => {
    const { trackingToken } = validated<TrackingParams>(response, 'params');
    sendData(
      response,
      201,
      await this.tracking.submitFeedback(trackingToken, validated<FeedbackBody>(response, 'body')),
    );
  };

  public requestReschedule = async (_request: Request, response: Response): Promise<void> => {
    const { trackingToken } = validated<TrackingParams>(response, 'params');
    sendData(
      response,
      202,
      await this.tracking.requestReschedule(
        trackingToken,
        validated<RescheduleBody>(response, 'body'),
      ),
    );
  };
}
