import { Router } from 'express';

import { dynamoDB, ORDERS_TABLE_NAME } from '../config/db.js';
import { ANALYTICS_BUCKET, DELIVERY_PROOF_BUCKET, s3Client } from '../config/s3.js';
import { WEBSOCKET_PUBLIC_URL, webSocketManagementClient } from '../config/realtime.js';
import { ANALYTICS_STATE_MACHINE_ARN, stepFunctionsClient } from '../config/analytics.js';
import { AnalyticsRunController } from '../controllers/analytics-run.controller.js';
import { DeliveryProofController } from '../controllers/delivery-proof.controller.js';
import { AnalyticsController } from '../controllers/analytics.controller.js';
import { DriverController } from '../controllers/driver.controller.js';
import { OrderController } from '../controllers/order.controller.js';
import { RealtimeController } from '../controllers/realtime.controller.js';
import { TrackingController } from '../controllers/tracking.controller.js';
import { RouteController } from '../controllers/route.controller.js';
import { GeocodingController } from '../controllers/geocoding.controller.js';
import { OperationsController } from '../controllers/operations.controller.js';
import { PushController } from '../controllers/push.controller.js';
import { TelemetryController } from '../controllers/telemetry.controller.js';
import { authenticateRequest, requireRole } from '../middlewares/authentication.js';
import {
  requireDriverOwnerOrAdmin,
  requireOrderOwnerOrAdmin,
} from '../middlewares/authorization.js';
import { DeliveryProofService } from '../services/delivery-proof.service.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { AnalyticsRunService } from '../services/analytics-run.service.js';
import { DriverService } from '../services/driver.service.js';
import { OrderService } from '../services/order.service.js';
import { OrderEventService } from '../services/order-event.service.js';
import { RealtimeBroadcaster } from '../services/realtime-broadcaster.service.js';
import { RealtimeTicketService } from '../services/realtime-ticket.service.js';
import { TrackingService } from '../services/tracking.service.js';
import { IdempotencyService } from '../services/idempotency.service.js';
import { enforceIdempotency } from '../middlewares/idempotency.js';
import { RouteService } from '../services/route.service.js';
import { GeocodingService } from '../services/geocoding.service.js';
import { OperationsService } from '../services/operations.service.js';
import { PushService } from '../services/push.service.js';

const orderService = new OrderService(dynamoDB, ORDERS_TABLE_NAME);
const orderEventService = new OrderEventService(dynamoDB, ORDERS_TABLE_NAME);
const driverService = new DriverService(dynamoDB, ORDERS_TABLE_NAME);
const pushService = new PushService(dynamoDB, ORDERS_TABLE_NAME);
const idempotencyService = new IdempotencyService(dynamoDB, ORDERS_TABLE_NAME);
const orderController = new OrderController(orderService, orderEventService, pushService);
const routeController = new RouteController(
  new RouteService(dynamoDB, ORDERS_TABLE_NAME, orderService, driverService),
  pushService,
);
const pushController = new PushController(pushService);
const telemetryController = new TelemetryController();
const geocodingController = new GeocodingController(new GeocodingService());
const operationsController = new OperationsController(new OperationsService(orderService));
const requireOrderAccess = requireOrderOwnerOrAdmin(orderService);
const deliveryProofController = new DeliveryProofController(
  orderService,
  new DeliveryProofService(dynamoDB, ORDERS_TABLE_NAME, s3Client, DELIVERY_PROOF_BUCKET),
);
const analyticsController = new AnalyticsController(
  new AnalyticsService(s3Client, ANALYTICS_BUCKET),
);
const analyticsRunController = new AnalyticsRunController(
  new AnalyticsRunService(stepFunctionsClient, ANALYTICS_STATE_MACHINE_ARN),
);
const realtimeBroadcaster = new RealtimeBroadcaster(
  dynamoDB,
  ORDERS_TABLE_NAME,
  webSocketManagementClient,
);
const driverController = new DriverController(
  new DriverService(dynamoDB, ORDERS_TABLE_NAME, realtimeBroadcaster),
);
const trackingController = new TrackingController(
  new TrackingService(dynamoDB, ORDERS_TABLE_NAME, orderService, orderEventService, driverService),
);
const realtimeController = new RealtimeController(
  new RealtimeTicketService(dynamoDB, ORDERS_TABLE_NAME, WEBSOCKET_PUBLIC_URL),
);

export const apiRouter = Router();

// Capability-token route: deliberately public and registered before Cognito.
// Payload fields are strict enums/numbers and contain no customer identifiers.
apiRouter.post('/telemetry/frontend', telemetryController.collect);
apiRouter.get('/tracking/:trackingToken', trackingController.get);
apiRouter.post(
  '/tracking/:trackingToken/feedback',
  enforceIdempotency(idempotencyService),
  trackingController.submitFeedback,
);
apiRouter.post(
  '/tracking/:trackingToken/reschedule',
  enforceIdempotency(idempotencyService),
  trackingController.requestReschedule,
);

apiRouter.use(authenticateRequest);
apiRouter.use(enforceIdempotency(idempotencyService));

apiRouter.post('/orders', requireRole('ADMIN'), orderController.createOrder);
apiRouter.post('/orders/import', requireRole('ADMIN'), orderController.importCsv);
apiRouter.get('/orders/export.csv', requireRole('ADMIN'), orderController.exportCsv);
apiRouter.get('/orders', requireRole('ADMIN', 'DRIVER'), orderController.listOrders);
apiRouter.get(
  '/orders/:id',
  requireRole('ADMIN', 'DRIVER'),
  requireOrderAccess,
  orderController.getOrder,
);
apiRouter.get(
  '/orders/:id/events',
  requireRole('ADMIN', 'DRIVER'),
  requireOrderAccess,
  orderController.listEvents,
);
apiRouter.get('/orders/:id/tracking-link', requireRole('ADMIN'), orderController.getTrackingLink);
apiRouter.patch('/orders/:id/assign', requireRole('ADMIN'), orderController.assignDriver);
apiRouter.post('/geocoding/validate', requireRole('ADMIN'), geocodingController.validate);
apiRouter.post('/routes', requireRole('ADMIN'), routeController.create);
apiRouter.get('/routes', requireRole('ADMIN'), routeController.list);
apiRouter.get('/routes/:id', requireRole('ADMIN', 'DRIVER'), routeController.get);
apiRouter.patch('/routes/:id/reorder', requireRole('ADMIN'), routeController.reorder);
apiRouter.post('/routes/:id/re-optimize', requireRole('ADMIN'), routeController.reoptimize);
apiRouter.get('/operations/issues', requireRole('ADMIN'), operationsController.listIssues);
apiRouter.patch(
  '/orders/:id/status',
  requireRole('ADMIN', 'DRIVER'),
  requireOrderAccess,
  orderController.updateStatus,
);
apiRouter.get('/upload-url', requireRole('ADMIN'), orderController.getUploadUrl);
apiRouter.get(
  '/orders/:id/proof/upload-url',
  requireRole('ADMIN', 'DRIVER'),
  requireOrderAccess,
  deliveryProofController.createUploadUrl,
);
apiRouter.post(
  '/orders/:id/proof',
  requireRole('ADMIN', 'DRIVER'),
  requireOrderAccess,
  deliveryProofController.registerProof,
);
apiRouter.get(
  '/orders/:id/proof',
  requireRole('ADMIN', 'DRIVER'),
  requireOrderAccess,
  deliveryProofController.getProof,
);
apiRouter.get(
  '/orders/:id/proof/view-url',
  requireRole('ADMIN'),
  deliveryProofController.getViewUrl,
);
apiRouter.get('/drivers', requireRole('ADMIN'), driverController.listDrivers);
apiRouter.post('/drivers', requireRole('ADMIN'), driverController.createDriver);
apiRouter.get(
  '/drivers/:id',
  requireRole('ADMIN', 'DRIVER'),
  requireDriverOwnerOrAdmin,
  driverController.getDriver,
);
apiRouter.patch('/drivers/:id/status', requireRole('ADMIN'), driverController.updateStatus);
apiRouter.patch(
  '/drivers/:id/location',
  requireRole('ADMIN', 'DRIVER'),
  requireDriverOwnerOrAdmin,
  driverController.updateLocation,
);
apiRouter.get('/push/public-key', requireRole('ADMIN', 'DRIVER'), pushController.getPublicKey);
apiRouter.post(
  '/drivers/:id/push-subscriptions',
  requireRole('ADMIN', 'DRIVER'),
  requireDriverOwnerOrAdmin,
  pushController.subscribe,
);
apiRouter.delete(
  '/drivers/:id/push-subscriptions',
  requireRole('ADMIN', 'DRIVER'),
  requireDriverOwnerOrAdmin,
  pushController.unsubscribe,
);
apiRouter.post('/realtime/ticket', requireRole('ADMIN'), realtimeController.createTicket);
apiRouter.get('/analytics/overview', requireRole('ADMIN'), analyticsController.getOverview);
apiRouter.post('/analytics/runs', requireRole('ADMIN'), analyticsRunController.start);
apiRouter.get('/analytics/runs/:runId', requireRole('ADMIN'), analyticsRunController.get);
