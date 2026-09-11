import assert from 'node:assert/strict';
import test from 'node:test';

import { VehicleCapacityPolicy } from '../../src/domain/policies/vehicle-capacity.policy.js';
import { AppError } from '../../src/errors/app-error.js';
import type { ClockPort } from '../../src/ports/clock.port.js';
import type { IdGeneratorPort } from '../../src/ports/id-generator.port.js';
import type { PushPort } from '../../src/ports/push.port.js';
import type { OrderRepository } from '../../src/repositories/order.repository.js';
import { OrderAssignmentService } from '../../src/services/order-assignment.service.js';
import { RouteComparisonService } from '../../src/services/route-comparison.service.js';
import type { OrderService } from '../../src/services/order.service.js';
import type { RouteService } from '../../src/services/route.service.js';
import { RouteWorkflowService } from '../../src/services/route-workflow.service.js';
import { TrackingTokenService } from '../../src/services/tracking-token.service.js';
import { AssignDriverUseCase } from '../../src/use-cases/orders/assign-driver.use-case.js';
import { CreateOrderUseCase } from '../../src/use-cases/orders/create-order.use-case.js';
import { UpdateOrderStatusUseCase } from '../../src/use-cases/orders/update-order-status.use-case.js';
import { orderFixture } from '../helpers/fixtures.js';

const fixedClock: ClockPort = { now: () => new Date('2026-09-12T03:00:00.000Z') };
const fixedIds: IdGeneratorPort = { next: () => '00000000-0000-4000-8000-000000000099' };

const trackingTokens = () =>
  new TrackingTokenService(
    {
      findTrackingToken: async () => null,
      saveTrackingToken: async () => undefined,
    },
    'https://tracking.test',
    fixedClock,
    () => 'fixed-token',
  );

test('create order use case is deterministic with clock, ID and repository ports', async () => {
  let stored = null as Parameters<OrderRepository['create']>[0] | null;
  const repository = {
    create: async (order: Parameters<OrderRepository['create']>[0]) => {
      stored = order;
    },
    getDriverCapacity: async () => ({ maxWeightKg: 20, maxVolumeM3: 0.25 }),
    list: async () => [],
  } as unknown as Pick<OrderRepository, 'create' | 'getDriverCapacity' | 'list'>;
  const useCase = new CreateOrderUseCase(
    repository,
    new VehicleCapacityPolicy(),
    trackingTokens(),
    fixedClock,
    fixedIds,
  );

  const order = await useCase.execute({
    customerName: 'Customer',
    customerPhone: '+84901234567',
    dropoffAddress: '1 Main Street',
    region: 'District 1',
    lat: 10.77,
    lng: 106.7,
  });

  assert.equal(order.orderId, fixedIds.next());
  assert.equal(order.createdAt, fixedClock.now().toISOString());
  assert.equal(stored, order);
});

test('vehicle capacity policy remains pure and reports the computed load', () => {
  const policy = new VehicleCapacityPolicy();
  assert.throws(
    () =>
      policy.assertFits(
        { maxWeightKg: 5, maxVolumeM3: 1 },
        [orderFixture({ status: 'ASSIGNED', driverId: 'DRV-001', packageWeightKg: 4 })],
        [orderFixture({ orderId: 'next', packageWeightKg: 2 })],
      ),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'VEHICLE_CAPACITY_EXCEEDED' &&
      error.details?.requested !== undefined,
  );
});

test('status and assignment use cases run against plain in-memory ports', async () => {
  let order = orderFixture();
  const repository = {
    getById: async () => order,
    proofExists: async () => true,
    updateStatus: async (change: Parameters<OrderRepository['updateStatus']>[0]) => {
      order = change.next;
    },
    getDriverCapacity: async () => ({ maxWeightKg: 20, maxVolumeM3: 1 }),
    list: async () => [],
    assign: async (_current: unknown, driverId: string) => {
      order = { ...order, driverId, status: 'ASSIGNED' };
    },
  } as unknown as Pick<
    OrderRepository,
    'getById' | 'proofExists' | 'updateStatus' | 'getDriverCapacity' | 'list' | 'assign'
  >;
  const assign = new AssignDriverUseCase(repository, new VehicleCapacityPolicy(), fixedClock);
  const assigned = await assign.execute(order.orderId, 'DRV-001');
  assert.equal(assigned.status, 'ASSIGNED');

  const update = new UpdateOrderStatusUseCase(repository, trackingTokens(), fixedClock);
  const started = await update.execute(order.orderId, { status: 'IN_PROGRESS' });
  assert.equal(started.startedAt, fixedClock.now().toISOString());
});

test('route comparison uses an injected clock and no provider client', () => {
  const service = new RouteComparisonService(fixedClock);
  const order = orderFixture({
    status: 'IN_PROGRESS',
    startedAt: '2026-09-12T02:00:00.000Z',
    plannedArrivalAt: '2026-09-12T02:30:00.000Z',
    timeWindowEnd: '2026-09-12T02:45:00.000Z',
  });
  const stop = service.stop('route-1', order, {
    orderId: order.orderId,
    sequence: 1,
    plannedArrivalAt: order.plannedArrivalAt!,
    plannedDepartureAt: '2026-09-12T02:40:00.000Z',
    plannedTravelDurationSeconds: 600,
    plannedDistanceMeters: 2_000,
  });
  assert.equal(stop.slaStatus, 'LATE');
  assert.equal(service.compare(1_800, [order], [stop]).actualDurationSeconds, 3_600);
});

test('assignment response does not wait for push delivery', async () => {
  const order = orderFixture({ status: 'ASSIGNED', driverId: 'DRV-001' });
  let finishPush!: () => void;
  const pushStarted = new Promise<void>((resolve) => {
    finishPush = resolve;
  });
  const push = {
    notifyDriver: async () => {
      await pushStarted;
      return { sent: 1, configured: true };
    },
  } satisfies PushPort;
  const orders = { assignDriver: async () => order } as unknown as OrderService;

  const result = await new OrderAssignmentService(orders, push).assign(
    order.orderId,
    order.driverId!,
    'admin-1',
  );
  assert.equal(result, order);
  finishPush();
});

test('route creation response does not wait for push delivery', async () => {
  const route = {
    routeId: 'route-1',
    driverId: 'DRV-001',
    scheduledDate: '2026-09-12',
    stopCount: 2,
  } as Awaited<ReturnType<RouteService['createRoute']>>;
  let finishPush!: () => void;
  const pushStarted = new Promise<void>((resolve) => {
    finishPush = resolve;
  });
  const push = {
    notifyDriver: async () => {
      await pushStarted;
      return { sent: 1, configured: true };
    },
  } satisfies PushPort;
  const routes = { createRoute: async () => route } as unknown as RouteService;

  const result = await new RouteWorkflowService(routes, push).create(
    {
      driverId: route.driverId,
      orderIds: ['order-1', 'order-2'],
      scheduledDate: route.scheduledDate,
    },
    'admin-1',
  );
  assert.equal(result, route);
  finishPush();
});
