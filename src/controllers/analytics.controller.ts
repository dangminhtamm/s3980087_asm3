import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendData } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type { analyticsOverviewQuerySchema } from '../schemas/analytics.schema.js';
import type { AnalyticsService } from '../services/analytics.service.js';

type AnalyticsQuery = z.infer<typeof analyticsOverviewQuerySchema>;

export class AnalyticsController {
  public constructor(private readonly analytics: AnalyticsService) {}

  public getOverview = async (_request: Request, response: Response): Promise<void> => {
    sendData(
      response,
      200,
      await this.analytics.getOverview(validated<AnalyticsQuery>(response, 'query')),
    );
  };
}
