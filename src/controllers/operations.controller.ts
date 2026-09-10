import type { NextFunction, Request, Response } from 'express';

import { operationalIssuesQuerySchema } from '../schemas/operations.schema.js';
import type { OperationsService } from '../services/operations.service.js';

export class OperationsController {
  public constructor(private readonly operations: OperationsService) {}
  public listIssues = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { limit } = operationalIssuesQuerySchema.parse(request.query);
      response.status(200).json({ data: await this.operations.listIssues(limit) });
    } catch (error: unknown) { next(error); }
  };
}
