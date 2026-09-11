import { Router } from 'express';

import { asyncHandler } from '../http/async-handler.js';
import { requireRole } from '../middlewares/authentication.js';
import { requireDriverOwnerOrAdmin } from '../middlewares/authorization.js';
import { validateRequest } from '../middlewares/validation.js';
import {
  createDriverSchema,
  driverIdParamsSchema,
  listDriversQuerySchema,
  updateDriverLocationSchema,
  updateDriverStatusSchema,
} from '../schemas/driver.schema.js';
import { pushSubscriptionSchema, pushUnsubscribeSchema } from '../schemas/push.schema.js';
import type { ApiDependencies } from './types.js';

export const createDriversRouter = ({ controllers }: ApiDependencies): Router => {
  const router = Router();
  const drivers = controllers.drivers;

  router.get(
    '/drivers',
    requireRole('ADMIN'),
    validateRequest({ query: listDriversQuerySchema }),
    asyncHandler(drivers.listDrivers),
  );
  router.post(
    '/drivers',
    requireRole('ADMIN'),
    validateRequest({ body: createDriverSchema }),
    asyncHandler(drivers.createDriver),
  );
  router.get(
    '/drivers/:id',
    requireRole('ADMIN', 'DRIVER'),
    requireDriverOwnerOrAdmin,
    validateRequest({ params: driverIdParamsSchema }),
    asyncHandler(drivers.getDriver),
  );
  router.patch(
    '/drivers/:id/status',
    requireRole('ADMIN'),
    validateRequest({ params: driverIdParamsSchema, body: updateDriverStatusSchema }),
    asyncHandler(drivers.updateStatus),
  );
  router.patch(
    '/drivers/:id/location',
    requireRole('ADMIN', 'DRIVER'),
    requireDriverOwnerOrAdmin,
    validateRequest({ params: driverIdParamsSchema, body: updateDriverLocationSchema }),
    asyncHandler(drivers.updateLocation),
  );
  router.get('/push/public-key', requireRole('ADMIN', 'DRIVER'), controllers.push.getPublicKey);
  router.post(
    '/drivers/:id/push-subscriptions',
    requireRole('ADMIN', 'DRIVER'),
    requireDriverOwnerOrAdmin,
    validateRequest({ params: driverIdParamsSchema, body: pushSubscriptionSchema }),
    asyncHandler(controllers.push.subscribe),
  );
  router.delete(
    '/drivers/:id/push-subscriptions',
    requireRole('ADMIN', 'DRIVER'),
    requireDriverOwnerOrAdmin,
    validateRequest({ params: driverIdParamsSchema, body: pushUnsubscribeSchema }),
    asyncHandler(controllers.push.unsubscribe),
  );
  router.post(
    '/realtime/ticket',
    requireRole('ADMIN'),
    asyncHandler(controllers.realtime.createTicket),
  );
  return router;
};
