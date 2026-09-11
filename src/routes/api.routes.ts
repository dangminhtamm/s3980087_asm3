import { Router } from 'express';

import { createAnalyticsRouter } from './analytics.routes.js';
import { createDriversRouter } from './drivers.routes.js';
import { createOrdersRouter } from './orders.routes.js';
import { createRoutesRouter } from './routes.routes.js';
import { createTrackingRouter } from './tracking.routes.js';
import type { ApiDependencies } from './types.js';

export const createApiRouter = (dependencies: ApiDependencies): Router => {
  const router = Router();

  router.use(createTrackingRouter(dependencies));
  router.use(dependencies.middleware.authenticate);
  router.use(dependencies.middleware.idempotency);
  router.use(createOrdersRouter(dependencies));
  router.use(createDriversRouter(dependencies));
  router.use(createRoutesRouter(dependencies));
  router.use(createAnalyticsRouter(dependencies));

  return router;
};
