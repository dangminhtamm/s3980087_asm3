import assert from 'node:assert/strict';
import test from 'node:test';

import type { Order } from '../../src/domain/entities/order.js';
import { optimizeSequence, RoutingService } from '../../src/services/routing.service.js';

const order = (orderId: string, lat: number, lng: number, windowEnd: string | null = null): Order => ({
  orderId, customerName: orderId, customerPhone: '+84901234567', dropoffAddress: 'Test address', region: 'D1',
  lat, lng, status: 'PENDING', driverId: null, createdAt: '2026-09-10T00:00:00.000Z', deliveredAt: null,
  exception: null, timeWindowStart: null, timeWindowEnd: windowEnd, packageWeightKg: 1, packageVolumeM3: 0.01,
  serviceDurationMinutes: 10, routeId: null, stopSequence: null, startedAt: null, arrivedAt: null, plannedArrivalAt: null,
});

test('optimizer prioritizes a time-window breach over a slightly shorter leg', () => {
  const matrix = {
    durations: [[0, 100, 120], [100, 0, 100], [120, 100, 0]],
    distances: [[0, 1000, 1200], [1000, 0, 1000], [1200, 1000, 0]], provider: 'test',
  };
  const departure = '2026-09-10T00:00:00.000Z';
  const sequence = optimizeSequence(matrix, [order('near', 0, 0), order('urgent', 0, 0, '2026-09-10T00:01:00.000Z')], departure);
  assert.deepEqual(sequence, [2, 1]);
});

test('fallback route plan returns deterministic ETA, distance and geometry', async () => {
  const service = new RoutingService('straight-line');
  const plan = await service.plan({ lat: 10.77, lng: 106.7 }, [order('one', 10.78, 106.71)], '2026-09-10T01:00:00.000Z');
  assert.equal(plan.provider, 'straight-line-fallback');
  assert.ok(plan.plannedDistanceMeters > 0);
  assert.ok(plan.plannedDurationSeconds > 600);
  assert.equal(plan.geometry.length, 2);
});
