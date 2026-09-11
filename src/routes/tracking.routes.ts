import { Router } from 'express';

import { asyncHandler } from '../http/async-handler.js';
import { validateRequest } from '../middlewares/validation.js';
import { frontendTelemetrySchema } from '../schemas/telemetry.schema.js';
import {
  customerFeedbackSchema,
  customerRescheduleSchema,
  trackingTokenParamsSchema,
} from '../schemas/tracking.schema.js';
import type { ApiDependencies } from './types.js';

/** Public capability-token routes; mount before authentication middleware. */
export const createTrackingRouter = ({ controllers, middleware }: ApiDependencies): Router => {
  const router = Router();
  router.post(
    '/telemetry/frontend',
    validateRequest({ body: frontendTelemetrySchema }),
    asyncHandler(controllers.telemetry.collect),
  );
  router.get(
    '/tracking/:trackingToken',
    validateRequest({ params: trackingTokenParamsSchema }),
    asyncHandler(controllers.tracking.get),
  );
  router.post(
    '/tracking/:trackingToken/feedback',
    middleware.idempotency,
    validateRequest({ params: trackingTokenParamsSchema, body: customerFeedbackSchema }),
    asyncHandler(controllers.tracking.submitFeedback),
  );
  router.post(
    '/tracking/:trackingToken/reschedule',
    middleware.idempotency,
    validateRequest({ params: trackingTokenParamsSchema, body: customerRescheduleSchema }),
    asyncHandler(controllers.tracking.requestReschedule),
  );
  return router;
};
