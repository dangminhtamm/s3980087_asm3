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
import { VehicleCapacityPolicy } from './domain/policies/vehicle-capacity.policy.js';
import { DynamoDocumentDatabaseAdapter } from './infrastructure/dynamodb/database.adapter.js';
import { createAuthenticateRequest } from './middlewares/authentication.js';
import { requireOrderOwnerOrAdmin } from './middlewares/authorization.js';
import { enforceIdempotency } from './middlewares/idempotency.js';
import { configureMetrics } from './observability/metrics.js';
import { systemClock } from './ports/clock.port.js';
import { randomIdGenerator } from './ports/id-generator.port.js';
import { OrderRepository } from './repositories/order.repository.js';
import { RouteRepository } from './repositories/route.repository.js';
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
import { RouteComparisonService } from './services/route-comparison.service.js';
import { RoutePlanner } from './services/route-planner.js';
import { RouteWorkflowService } from './services/route-workflow.service.js';
import { RouteService } from './services/route.service.js';
import { RoutingService } from './services/routing.service.js';
import { TrackingService } from './services/tracking.service.js';
import { TrackingTokenService } from './services/tracking-token.service.js';
import { AssignDriverUseCase } from './use-cases/orders/assign-driver.use-case.js';
import { CreateOrderUseCase } from './use-cases/orders/create-order.use-case.js';
import { UpdateOrderStatusUseCase } from './use-cases/orders/update-order-status.use-case.js';
import { RouteAssignmentUseCase } from './use-cases/routes/route-assignment.use-case.js';

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
  const database = new DynamoDocumentDatabaseAdapter(databaseClients.document);
  const vehicleCapacity = new VehicleCapacityPolicy();

  const realtimeBroadcaster = new RealtimeBroadcaster(
    databaseClients.document,
    tableName,
    webSocketManagementClient,
  );
  const orderEventService = new OrderEventService(databaseClients.document, tableName);
  const driverService = new DriverService(databaseClients.document, tableName, realtimeBroadcaster);
  const orderRepository = new OrderRepository(database, tableName);
  const trackingTokenService = new TrackingTokenService(
    orderRepository,
    config.tracking.baseUrl,
    systemClock,
  );
  const createOrder = new CreateOrderUseCase(
    orderRepository,
    vehicleCapacity,
    trackingTokenService,
    systemClock,
    randomIdGenerator,
  );
  const updateOrderStatus = new UpdateOrderStatusUseCase(
    orderRepository,
    trackingTokenService,
    systemClock,
  );
  const assignDriver = new AssignDriverUseCase(orderRepository, vehicleCapacity, systemClock);
  const orderService = new OrderService(
    orderRepository,
    createOrder,
    updateOrderStatus,
    assignDriver,
    trackingTokenService,
  );
  const pushService = new PushService(databaseClients.document, tableName, config.push);
  const idempotencyService = new IdempotencyService(databaseClients.document, tableName);
  const routingService = new RoutingService(config.routing.provider, config.routing.baseUrl);
  const routeRepository = new RouteRepository(database, tableName);
  const routePlanner = new RoutePlanner(routingService);
  const routeComparison = new RouteComparisonService(systemClock);
  const routeAssignment = new RouteAssignmentUseCase(
    routeRepository,
    orderService,
    driverService,
    routePlanner,
    routeComparison,
    vehicleCapacity,
    systemClock,
    randomIdGenerator,
    config.routing.origin,
  );
  const routeService = new RouteService(
    routeRepository,
    routeAssignment,
    orderService,
    driverService,
    routePlanner,
    routeComparison,
    systemClock,
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
