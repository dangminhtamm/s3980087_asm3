import type { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { S3Client } from '@aws-sdk/client-s3';
import type { SFNClient } from '@aws-sdk/client-sfn';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { createStepFunctionsClient } from './config/analytics.js';
import type { AppConfig } from './config/app-config.js';
import { createDatabaseClients } from './config/db.js';
import { createWebSocketManagementClient } from './config/realtime.js';
import { createObjectStorageClients } from './config/s3.js';
import { AnalyticsRunController } from './controllers/analytics-run.controller.js';
import { AnalyticsController } from './controllers/analytics.controller.js';
import { DeliveryProofController } from './controllers/delivery-proof.controller.js';
import { DriverController } from './controllers/driver.controller.js';
import { GeocodingController } from './controllers/geocoding.controller.js';
import { OperationsController } from './controllers/operations.controller.js';
import { OrderController } from './controllers/order.controller.js';
import { PushController } from './controllers/push.controller.js';
import { RealtimeController } from './controllers/realtime.controller.js';
import { RouteController } from './controllers/route.controller.js';
import { TelemetryController } from './controllers/telemetry.controller.js';
import { TrackingController } from './controllers/tracking.controller.js';
import { createAuthenticateRequest } from './middlewares/authentication.js';
import { requireOrderOwnerOrAdmin } from './middlewares/authorization.js';
import { enforceIdempotency } from './middlewares/idempotency.js';
import { configureMetrics } from './observability/metrics.js';
import type { ApiDependencies } from './routes/types.js';
import { AnalyticsRunService } from './services/analytics-run.service.js';
import { AnalyticsService } from './services/analytics.service.js';
import { DeliveryProofWorkflowService } from './services/delivery-proof-workflow.service.js';
import { DeliveryProofService } from './services/delivery-proof.service.js';
import { DriverService } from './services/driver.service.js';
import { GeocodingService } from './services/geocoding.service.js';
import { IdempotencyService } from './services/idempotency.service.js';
import { OperationsService } from './services/operations.service.js';
import { OrderApplicationService } from './services/order-application.service.js';
import { OrderAssignmentService } from './services/order-assignment.service.js';
import { OrderCsvService } from './services/order-csv.service.js';
import { OrderEventService } from './services/order-event.service.js';
import { OrderService } from './services/order.service.js';
import { PushService } from './services/push.service.js';
import { RealtimeBroadcaster } from './services/realtime-broadcaster.service.js';
import { RealtimeTicketService } from './services/realtime-ticket.service.js';
import { RouteApplicationService } from './services/route-application.service.js';
import { RouteWorkflowService } from './services/route-workflow.service.js';
import { RouteService } from './services/route.service.js';
import { RoutingService } from './services/routing.service.js';
import { TrackingService } from './services/tracking.service.js';

export interface InfrastructureClients {
  databaseClient: DynamoDBClient;
  database: DynamoDBDocumentClient;
  objectStorageClient: S3Client;
  presignClient: S3Client;
  stepFunctionsClient: SFNClient;
  webSocketManagementClient: ApiGatewayManagementApiClient | null;
}

export interface ApplicationContainer {
  config: AppConfig;
  api: ApiDependencies;
  clients: InfrastructureClients;
  close(): void;
}

/** The only production object graph. Every service is constructed exactly once here. */
export const createContainer = (config: AppConfig): ApplicationContainer => {
  configureMetrics(config.observability);

  const databaseClients = createDatabaseClients(config);
  const storageClients = createObjectStorageClients(config);
  const stepFunctionsClient = createStepFunctionsClient(config);
  const webSocketManagementClient = createWebSocketManagementClient(config);
  const tableName = config.dynamodb.tableName;

  const realtimeBroadcaster = new RealtimeBroadcaster(
    databaseClients.document,
    tableName,
    webSocketManagementClient,
  );
  const orderService = new OrderService(
    databaseClients.document,
    tableName,
    config.tracking.baseUrl,
  );
  const orderEventService = new OrderEventService(databaseClients.document, tableName);
  const driverService = new DriverService(databaseClients.document, tableName, realtimeBroadcaster);
  const pushService = new PushService(databaseClients.document, tableName, config.push);
  const idempotencyService = new IdempotencyService(databaseClients.document, tableName);
  const routingService = new RoutingService(config.routing.provider, config.routing.baseUrl);
  const routeService = new RouteService(
    databaseClients.document,
    tableName,
    orderService,
    driverService,
    routingService,
    config.routing.origin,
  );
  const deliveryProofService = new DeliveryProofService(
    databaseClients.document,
    tableName,
    storageClients.client,
    config.s3.deliveryProofBucket,
  );
  const deliveryProofWorkflow = new DeliveryProofWorkflowService(
    orderService,
    deliveryProofService,
    storageClients.presignClient,
    config.s3.deliveryProofBucket,
  );
  const orderApplication = new OrderApplicationService(
    orderService,
    orderEventService,
    new OrderAssignmentService(orderService, pushService),
    new OrderCsvService(orderService),
    deliveryProofWorkflow,
  );
  const routeApplication = new RouteApplicationService(
    routeService,
    new RouteWorkflowService(routeService, pushService),
  );
  const analyticsService = new AnalyticsService(storageClients.client, config.s3.analyticsBucket);
  const analyticsRunService = new AnalyticsRunService(
    stepFunctionsClient,
    config.analytics.stateMachineArn,
  );
  const trackingService = new TrackingService(
    databaseClients.document,
    tableName,
    orderService,
    orderEventService,
    driverService,
  );

  const api: ApiDependencies = {
    controllers: {
      analytics: new AnalyticsController(analyticsService),
      analyticsRuns: new AnalyticsRunController(analyticsRunService),
      deliveryProofs: new DeliveryProofController(deliveryProofWorkflow),
      drivers: new DriverController(driverService),
      geocoding: new GeocodingController(
        new GeocodingService(
          config.geocoding.provider,
          config.geocoding.baseUrl,
          config.geocoding.userAgent,
          config.geocoding.minIntervalMs,
        ),
      ),
      operations: new OperationsController(new OperationsService(orderService)),
      orders: new OrderController(orderApplication),
      push: new PushController(pushService),
      realtime: new RealtimeController(
        new RealtimeTicketService(databaseClients.document, tableName, config.realtime.publicUrl),
      ),
      routes: new RouteController(routeApplication),
      telemetry: new TelemetryController(),
      tracking: new TrackingController(trackingService),
    },
    middleware: {
      authenticate: createAuthenticateRequest(config.auth),
      idempotency: enforceIdempotency(idempotencyService),
      requireOrderAccess: requireOrderOwnerOrAdmin(orderService),
    },
  };

  return {
    config,
    api,
    clients: {
      databaseClient: databaseClients.client,
      database: databaseClients.document,
      objectStorageClient: storageClients.client,
      presignClient: storageClients.presignClient,
      stepFunctionsClient,
      webSocketManagementClient,
    },
    close: () => {
      databaseClients.client.destroy();
      storageClients.client.destroy();
      if (storageClients.presignClient !== storageClients.client)
        storageClients.presignClient.destroy();
      stepFunctionsClient.destroy();
      webSocketManagementClient?.destroy();
    },
  };
};
