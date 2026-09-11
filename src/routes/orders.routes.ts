import { Router } from 'express';

import { asyncHandler } from '../http/async-handler.js';
import { requireRole } from '../middlewares/authentication.js';
import { validateRequest } from '../middlewares/validation.js';
import { validateAddressSchema } from '../schemas/geocoding.schema.js';
import { operationalIssuesQuerySchema } from '../schemas/operations.schema.js';
import {
  assignDriverSchema,
  createOrderSchema,
  exportOrdersQuerySchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  proofUploadQuerySchema,
  registerDeliveryProofSchema,
  updateOrderStatusSchema,
  uploadUrlQuerySchema,
} from '../schemas/order.schema.js';
import type { ApiDependencies } from './types.js';

export const createOrdersRouter = ({ controllers, middleware }: ApiDependencies): Router => {
  const router = Router();
  const orders = controllers.orders;
  const proofs = controllers.deliveryProofs;

  router.post(
    '/orders',
    requireRole('ADMIN'),
    validateRequest({ body: createOrderSchema }),
    asyncHandler(orders.createOrder),
  );
  router.post('/orders/import', requireRole('ADMIN'), asyncHandler(orders.importCsv));
  router.get(
    '/orders/export.csv',
    requireRole('ADMIN'),
    validateRequest({ query: exportOrdersQuerySchema }),
    asyncHandler(orders.exportCsv),
  );
  router.get(
    '/orders',
    requireRole('ADMIN', 'DRIVER'),
    validateRequest({ query: listOrdersQuerySchema }),
    asyncHandler(orders.listOrders),
  );
  router.get(
    '/orders/:id',
    requireRole('ADMIN', 'DRIVER'),
    middleware.requireOrderAccess,
    validateRequest({ params: orderIdParamsSchema }),
    asyncHandler(orders.getOrder),
  );
  router.get(
    '/orders/:id/events',
    requireRole('ADMIN', 'DRIVER'),
    middleware.requireOrderAccess,
    validateRequest({ params: orderIdParamsSchema }),
    asyncHandler(orders.listEvents),
  );
  router.get(
    '/orders/:id/tracking-link',
    requireRole('ADMIN'),
    validateRequest({ params: orderIdParamsSchema }),
    asyncHandler(orders.getTrackingLink),
  );
  router.patch(
    '/orders/:id/assign',
    requireRole('ADMIN'),
    validateRequest({ params: orderIdParamsSchema, body: assignDriverSchema }),
    asyncHandler(orders.assignDriver),
  );
  router.patch(
    '/orders/:id/status',
    requireRole('ADMIN', 'DRIVER'),
    middleware.requireOrderAccess,
    validateRequest({ params: orderIdParamsSchema, body: updateOrderStatusSchema }),
    asyncHandler(orders.updateStatus),
  );
  router.get(
    '/upload-url',
    requireRole('ADMIN'),
    validateRequest({ query: uploadUrlQuerySchema }),
    asyncHandler(orders.getUploadUrl),
  );
  router.post(
    '/geocoding/validate',
    requireRole('ADMIN'),
    validateRequest({ body: validateAddressSchema }),
    asyncHandler(controllers.geocoding.validate),
  );
  router.get(
    '/operations/issues',
    requireRole('ADMIN'),
    validateRequest({ query: operationalIssuesQuerySchema }),
    asyncHandler(controllers.operations.listIssues),
  );
  router.get(
    '/orders/:id/proof/upload-url',
    requireRole('ADMIN', 'DRIVER'),
    middleware.requireOrderAccess,
    validateRequest({ params: orderIdParamsSchema, query: proofUploadQuerySchema }),
    asyncHandler(proofs.createUploadUrl),
  );
  router.post(
    '/orders/:id/proof',
    requireRole('ADMIN', 'DRIVER'),
    middleware.requireOrderAccess,
    validateRequest({ params: orderIdParamsSchema, body: registerDeliveryProofSchema }),
    asyncHandler(proofs.registerProof),
  );
  router.get(
    '/orders/:id/proof',
    requireRole('ADMIN', 'DRIVER'),
    middleware.requireOrderAccess,
    validateRequest({ params: orderIdParamsSchema }),
    asyncHandler(proofs.getProof),
  );
  router.get(
    '/orders/:id/proof/view-url',
    requireRole('ADMIN'),
    validateRequest({ params: orderIdParamsSchema }),
    asyncHandler(proofs.getViewUrl),
  );
  return router;
};
