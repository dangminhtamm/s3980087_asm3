import assert from 'node:assert/strict';
import test from 'node:test';

import type { Order } from '../../src/domain/entities/order.js';
import { OperationsService } from '../../src/services/operations.service.js';
import type { OrderService } from '../../src/services/order.service.js';

const base: Order = {
  orderId: '00000000-0000-4000-8000-000000000001',
  customerName: 'A',
  customerPhone: '+84901234567',
  dropoffAddress: '1 Main Street',
  region: 'D1',
  lat: 10.7,
  lng: 106.7,
  status: 'ASSIGNED',
  driverId: 'DRV-1',
  createdAt: '2026-09-10T00:00:00.000Z',
  deliveredAt: null,
  exception: null,
  timeWindowStart: null,
  timeWindowEnd: '2026-09-10T01:00:00.000Z',
  packageWeightKg: 1,
  packageVolumeM3: 0.01,
  serviceDurationMinutes: 10,
  routeId: 'route-1',
  stopSequence: 1,
  startedAt: null,
  arrivedAt: null,
  plannedArrivalAt: '2026-09-10T01:15:00.000Z',
};

test('operations queue ranks breached SLA before predicted risk', async () => {
  const orders = [
    {
      ...base,
      orderId: '00000000-0000-4000-8000-000000000001',
      timeWindowEnd: '2026-09-10T00:30:00.000Z',
    },
    {
      ...base,
      orderId: '00000000-0000-4000-8000-000000000002',
      timeWindowEnd: '2026-09-10T01:10:00.000Z',
    },
  ];
  const service = new OperationsService({
    listOrders: async () => orders,
  } as unknown as OrderService);
  const issues = await service.listIssues(10, new Date('2026-09-10T01:00:00.000Z'));
  assert.deepEqual(
    issues.map((issue) => issue.type),
    ['SLA_BREACH', 'SLA_RISK'],
  );
});

test('operations queue characterizes every actionable order state', async () => {
  const orders: Order[] = [
    {
      ...base,
      orderId: 'customer-request',
      customerRescheduleRequest: {
        requestedWindowStart: '2026-09-10T02:00:00.000Z',
        requestedWindowEnd: '2026-09-10T03:00:00.000Z',
        notes: 'After lunch',
        requestedAt: '2026-09-10T00:30:00.000Z',
      },
    },
    {
      ...base,
      orderId: 'failed',
      status: 'DELIVERY_FAILED',
      exception: {
        reason: 'CUSTOMER_UNAVAILABLE',
        notes: 'No answer',
        reportedAt: '2026-09-10T00:20:00.000Z',
        reportedBy: 'DRV-001',
      },
    },
    { ...base, orderId: 'rescheduled', status: 'RESCHEDULED' },
    {
      ...base,
      orderId: 'urgent',
      status: 'PENDING',
      driverId: null,
      timeWindowStart: '2026-09-10T01:20:00.000Z',
      timeWindowEnd: '2026-09-10T02:00:00.000Z',
      plannedArrivalAt: null,
    },
    { ...base, orderId: 'done', status: 'DELIVERED' },
  ];
  const service = new OperationsService({
    listOrders: async () => orders,
  } as unknown as OrderService);

  const issues = await service.listIssues(20, new Date('2026-09-10T01:00:00.000Z'));
  assert.deepEqual(
    new Set(issues.map((issue) => issue.type)),
    new Set([
      'CUSTOMER_RESCHEDULE_REQUEST',
      'DELIVERY_EXCEPTION',
      'RESCHEDULE_REQUIRED',
      'UNASSIGNED_URGENT',
    ]),
  );
});
