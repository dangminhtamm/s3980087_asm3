import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendData } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type { analyticsRunParamsSchema } from '../schemas/analytics-run.schema.js';
import type { AnalyticsRunService } from '../services/analytics-run.service.js';

type AnalyticsRunParams = z.infer<typeof analyticsRunParamsSchema>;

export class AnalyticsRunController {
  public constructor(private readonly runs: AnalyticsRunService) {}

  public start = async (request: Request, response: Response): Promise<void> => {
    const requestedBy =
      request.authenticatedUser?.username ?? request.authenticatedUser?.subject ?? 'unknown';
    sendData(response, 202, await this.runs.start(requestedBy));
  };

  public get = async (_request: Request, response: Response): Promise<void> => {
    const { runId } = validated<AnalyticsRunParams>(response, 'params');
    sendData(response, 200, await this.runs.get(runId));
  };
}
