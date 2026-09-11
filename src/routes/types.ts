import type { RequestHandler } from 'express';

import type { AnalyticsRunController } from '../controllers/analytics-run.controller.js';
import type { AnalyticsController } from '../controllers/analytics.controller.js';
import type { DeliveryProofController } from '../controllers/delivery-proof.controller.js';
import type { DriverController } from '../controllers/driver.controller.js';
import type { GeocodingController } from '../controllers/geocoding.controller.js';
import type { OperationsController } from '../controllers/operations.controller.js';
import type { OrderController } from '../controllers/order.controller.js';
import type { PushController } from '../controllers/push.controller.js';
import type { RealtimeController } from '../controllers/realtime.controller.js';
import type { RouteController } from '../controllers/route.controller.js';
import type { TelemetryController } from '../controllers/telemetry.controller.js';
import type { TrackingController } from '../controllers/tracking.controller.js';

export interface ApiDependencies {
  controllers: {
    analytics: AnalyticsController;
    analyticsRuns: AnalyticsRunController;
    deliveryProofs: DeliveryProofController;
    drivers: DriverController;
    geocoding: GeocodingController;
    operations: OperationsController;
    orders: OrderController;
    push: PushController;
    realtime: RealtimeController;
    routes: RouteController;
    telemetry: TelemetryController;
    tracking: TrackingController;
  };
  middleware: {
    authenticate: RequestHandler;
    idempotency: RequestHandler;
    requireOrderAccess: RequestHandler;
  };
}
