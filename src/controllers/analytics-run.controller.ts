import type { NextFunction, Request, Response } from 'express';

import { analyticsRunParamsSchema } from '../schemas/analytics-run.schema.js';
import type { AnalyticsRunService } from '../services/analytics-run.service.js';

export class AnalyticsRunController {
  public constructor(private readonly runs: AnalyticsRunService) {}

  public start = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const requestedBy =
        request.authenticatedUser?.username ?? request.authenticatedUser?.subject ?? 'unknown';
      response.status(202).json({ data: await this.runs.start(requestedBy) });
    } catch (error: unknown) {
      next(error);
    }
  };

  public get = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { runId } = analyticsRunParamsSchema.parse(request.params);
      response.status(200).json({ data: await this.runs.get(runId) });
    } catch (error: unknown) {
      next(error);
    }
  };
}
