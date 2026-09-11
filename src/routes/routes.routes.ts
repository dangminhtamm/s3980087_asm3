import { Router } from 'express';

import { asyncHandler } from '../http/async-handler.js';
import { requireRole } from '../middlewares/authentication.js';
import { validateRequest } from '../middlewares/validation.js';
import {
  createRouteSchema,
  listRoutesQuerySchema,
  reorderRouteSchema,
  reoptimizeRouteSchema,
  routeIdParamsSchema,
} from '../schemas/route.schema.js';
import type { ApiDependencies } from './types.js';

export const createRoutesRouter = ({ controllers }: ApiDependencies): Router => {
  const router = Router();
  const routes = controllers.routes;

  router.post(
    '/routes',
    requireRole('ADMIN'),
    validateRequest({ body: createRouteSchema }),
    asyncHandler(routes.create),
  );
  router.get(
    '/routes',
    requireRole('ADMIN'),
    validateRequest({ query: listRoutesQuerySchema }),
    asyncHandler(routes.list),
  );
  router.get(
    '/routes/:id',
    requireRole('ADMIN', 'DRIVER'),
    validateRequest({ params: routeIdParamsSchema }),
    asyncHandler(routes.get),
  );
  router.patch(
    '/routes/:id/reorder',
    requireRole('ADMIN'),
    validateRequest({ params: routeIdParamsSchema, body: reorderRouteSchema }),
    asyncHandler(routes.reorder),
  );
  router.post(
    '/routes/:id/re-optimize',
    requireRole('ADMIN'),
    validateRequest({ params: routeIdParamsSchema, body: reoptimizeRouteSchema }),
    asyncHandler(routes.reoptimize),
  );
  return router;
};
