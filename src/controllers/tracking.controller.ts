import type { NextFunction, Request, Response } from 'express';

import {
  customerFeedbackSchema,
  customerRescheduleSchema,
  trackingTokenParamsSchema,
} from '../schemas/tracking.schema.js';
import type { TrackingService } from '../services/tracking.service.js';

export class TrackingController {
  public constructor(private readonly tracking: TrackingService) {}

  public get = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { trackingToken } = trackingTokenParamsSchema.parse(request.params);
      const tracking = await this.tracking.getTracking(trackingToken);
      response.setHeader('Cache-Control', 'private, no-store, max-age=0');
      response.setHeader('Pragma', 'no-cache');
      response.status(200).json({ data: tracking });
    } catch (error: unknown) {
      next(error);
    }
  };

  public submitFeedback = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { trackingToken } = trackingTokenParamsSchema.parse(request.params);
      const input = customerFeedbackSchema.parse(request.body);
      response.status(201).json({ data: await this.tracking.submitFeedback(trackingToken, input) });
    } catch (error: unknown) {
      next(error);
    }
  };

  public requestReschedule = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { trackingToken } = trackingTokenParamsSchema.parse(request.params);
      const input = customerRescheduleSchema.parse(request.body);
      response
        .status(202)
        .json({ data: await this.tracking.requestReschedule(trackingToken, input) });
    } catch (error: unknown) {
      next(error);
    }
  };
}
