import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type { DriverService } from '../../src/services/driver.service.js';
import { VehicleCapacityPolicy } from '../../src/domain/policies/vehicle-capacity.policy.js';
import type { DatabasePort } from '../../src/ports/database.port.js';
import { systemClock } from '../../src/ports/clock.port.js';
import { randomIdGenerator } from '../../src/ports/id-generator.port.js';
import { RouteRepository } from '../../src/repositories/route.repository.js';
import type { OrderService } from '../../src/services/order.service.js';
import { RouteComparisonService } from '../../src/services/route-comparison.service.js';
import { RoutePlanner } from '../../src/services/route-planner.js';
import { RouteService } from '../../src/services/route.service.js';
import type { RoutingService } from '../../src/services/routing.service.js';
import { RouteAssignmentUseCase } from '../../src/use-cases/routes/route-assignment.use-case.js';
import { driverFixture, orderFixture } from '../helpers/fixtures.js';

const createRouteService = (
  database: DynamoDBDocumentClient,
  orders: OrderService,
  drivers: DriverService,
  routing: RoutingService,
): RouteService => {
  const repository = new RouteRepository(database as unknown as DatabasePort, 'table');
  const planner = new RoutePlanner(routing);
  const comparison = new RouteComparisonService(systemClock);
  const assignment = new RouteAssignmentUseCase(
    repository,
    orders,
    drivers,
    planner,
    comparison,
    new VehicleCapacityPolicy(),
    systemClock,
    randomIdGenerator,
    { lat: 10.7769, lng: 106.7009 },
  );
  return new RouteService(
    repository,
    assignment,
    orders,
    drivers,
    planner,
    comparison,
    systemClock,
  );
};

test('route creation writes metadata, stops, assignments, events and driver atomically', async () => {
  const orders = [
    orderFixture({ orderId: '00000000-0000-4000-8000-000000000001' }),
    orderFixture({ orderId: '00000000-0000-4000-8000-000000000002', lat: 10.78 }),
  ];
  let transaction: TransactWriteCommand | null = null;
  const database = {
    send: async (command: unknown) => {
      if (command instanceof TransactWriteCommand) {
        transaction = command;
        return {};
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    },
  } as unknown as DynamoDBDocumentClient;
  const orderService = {
    getOrder: async (orderId: string) => orders.find((order) => order.orderId === orderId)!,
    listOrders: async () => [],
  } as unknown as OrderService;
  const driver = driverFixture();
  const driverService = { getDriver: async () => driver } as unknown as DriverService;
  const routing = {
    plan: async () => ({
      stops: orders.map((order, index) => ({
        orderId: order.orderId,
        sequence: index + 1,
        plannedArrivalAt: `2026-09-10T01:${String(index * 20).padStart(2, '0')}:00.000Z`,
        plannedDepartureAt: `2026-09-10T01:${String(index * 20 + 10).padStart(2, '0')}:00.000Z`,
        plannedTravelDurationSeconds: 600,
        plannedDistanceMeters: 2_000,
      })),
      plannedDistanceMeters: 4_000,
      plannedDurationSeconds: 2_400,
      geometry: [[10.76, 106.69]],
      provider: 'characterization',
    }),
  } as unknown as RoutingService;

  const route = await createRouteService(
    database,
    orderService,
    driverService,
    routing,
  ).createRoute(
    {
      driverId: driver.driverId,
      orderIds: orders.map(({ orderId }) => orderId),
      scheduledDate: '2026-09-10',
    },
    'admin-1',
  );

  assert.equal(route.stops.length, 2);
  assert.ok(transaction);
  const items = transaction.input.TransactItems ?? [];
  assert.equal(items.length, 8);
  assert.equal(items.filter((item) => item.Put?.Item?.SK === 'METADATA').length, 1);
  assert.equal(items.filter((item) => String(item.Put?.Item?.SK).startsWith('STOP#')).length, 2);
  assert.equal(items.filter((item) => item.Put?.Item?.type === 'DRIVER_ASSIGNED').length, 2);
  assert.equal(items.filter((item) => item.Update?.Key?.SK === 'PROFILE').length, 1);
});

test('route reads combine stored plans with live order status and actual timing', async () => {
  const routeId = '00000000-0000-4000-8000-000000000010';
  const order = orderFixture({
    status: 'DELIVERED',
    driverId: 'DRV-001',
    routeId,
    stopSequence: 1,
    startedAt: '2026-09-10T01:00:00.000Z',
    arrivedAt: '2026-09-10T01:18:00.000Z',
    deliveredAt: '2026-09-10T01:20:00.000Z',
    plannedArrivalAt: '2026-09-10T01:15:00.000Z',
    timeWindowEnd: '2026-09-10T01:30:00.000Z',
  });
  const metadata = {
    routeId,
    driverId: 'DRV-001',
    scheduledDate: '2026-09-10',
    status: 'IN_PROGRESS',
    stopCount: 1,
    totalWeightKg: 1,
    totalVolumeM3: 0.01,
    createdAt: '2026-09-10T00:00:00.000Z',
    createdBy: 'admin-1',
    origin: { lat: 10.76, lng: 106.69 },
    plannedDistanceMeters: 2_000,
    plannedDurationSeconds: 1_800,
    geometry: [[10.76, 106.69]],
    optimization: {
      provider: 'characterization',
      mode: 'AUTO',
      optimizedAt: '2026-09-10T00:00:00.000Z',
      revision: 1,
    },
    PK: `ROUTE#${routeId}`,
    SK: 'METADATA',
  };
  const stop = {
    PK: `ROUTE#${routeId}`,
    SK: `STOP#001#ORDER#${order.orderId}`,
    orderId: order.orderId,
    sequence: 1,
    plannedArrivalAt: '2026-09-10T01:15:00.000Z',
    plannedDepartureAt: '2026-09-10T01:25:00.000Z',
    plannedTravelDurationSeconds: 900,
    plannedDistanceMeters: 2_000,
  };
  const database = {
    send: async (command: unknown) => {
      if (!(command instanceof QueryCommand)) throw new Error('Unexpected command');
      return command.input.IndexName ? { Items: [metadata] } : { Items: [metadata, stop] };
    },
  } as unknown as DynamoDBDocumentClient;
  const orders = { getOrder: async () => order } as unknown as OrderService;
  const drivers = { getDriver: async () => driverFixture() } as unknown as DriverService;
  const service = createRouteService(database, orders, drivers, {
    plan: async () => assert.fail('planning is not expected'),
  } as unknown as RoutingService);

  const route = await service.getRoute(routeId);
  assert.equal(route.status, 'COMPLETED');
  assert.equal(route.stops[0]?.slaStatus, 'ON_TIME');
  assert.equal(route.comparison.completedStops, 1);
  assert.equal(route.comparison.actualDurationSeconds, 1_080);

  assert.equal((await service.listRoutes('DRV-001', 10)).length, 1);
  assert.equal((await service.listRoutes(undefined, 10)).length, 2);
});
