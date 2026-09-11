import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendData } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type { operationalIssuesQuerySchema } from '../schemas/operations.schema.js';
import type { OperationsService } from '../services/operations.service.js';

type OperationsQuery = z.infer<typeof operationalIssuesQuerySchema>;

export class OperationsController {
  public constructor(private readonly operations: OperationsService) {}

  public listIssues = async (_request: Request, response: Response): Promise<void> => {
    const { limit } = validated<OperationsQuery>(response, 'query');
    sendData(response, 200, await this.operations.listIssues(limit));
  };
}
