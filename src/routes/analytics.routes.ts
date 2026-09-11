import { Router } from 'express';

import { asyncHandler } from '../http/async-handler.js';
import { requireRole } from '../middlewares/authentication.js';
import { validateRequest } from '../middlewares/validation.js';
import { analyticsRunParamsSchema } from '../schemas/analytics-run.schema.js';
import { analyticsOverviewQuerySchema } from '../schemas/analytics.schema.js';
import type { ApiDependencies } from './types.js';

export const createAnalyticsRouter = ({ controllers }: ApiDependencies): Router => {
  const router = Router();
  router.get(
    '/analytics/overview',
    requireRole('ADMIN'),
    validateRequest({ query: analyticsOverviewQuerySchema }),
    asyncHandler(controllers.analytics.getOverview),
  );
  router.post(
    '/analytics/runs',
    requireRole('ADMIN'),
    asyncHandler(controllers.analyticsRuns.start),
  );
  router.get(
    '/analytics/runs/:runId',
    requireRole('ADMIN'),
    validateRequest({ params: analyticsRunParamsSchema }),
    asyncHandler(controllers.analyticsRuns.get),
  );
  return router;
};
