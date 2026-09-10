import type { NextFunction, Request, Response } from 'express';

import { analyticsOverviewQuerySchema } from '../schemas/analytics.schema.js';
import type { AnalyticsService } from '../services/analytics.service.js';

export class AnalyticsController {
  public constructor(private readonly analytics: AnalyticsService) {}

  public getOverview = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query = analyticsOverviewQuerySchema.parse(request.query);
      response.status(200).json({ data: await this.analytics.getOverview(query) });
    } catch (error: unknown) {
      next(error);
    }
  };
}
