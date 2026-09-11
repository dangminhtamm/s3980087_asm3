import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, test } from 'vitest';

import type { AdminOrder } from '../types/admin';
import {
  cacheDriverOrders,
  clearOfflineData,
  getCachedDriverOrders,
  getOutboxSize,
  getQueuedMutations,
  queueMutation,
  removeQueuedMutation,
  updateCachedOrder,
} from './offline-store';

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: false },
});

const order: AdminOrder = {
  orderId: '00000000-0000-4000-8000-000000000001',
  customerName: 'Customer',
  customerPhone: '+84901234567',
  dropoffAddress: '1 Main Street',
  region: 'District 1',
  lat: 10.77,
  lng: 106.7,
  status: 'ASSIGNED',
  driverId: 'DRV-001',
  createdAt: '2026-09-10T00:00:00.000Z',
  deliveredAt: null,
  exception: null,
};

describe('offline outbox persistence', () => {
  beforeEach(async () => {
    await clearOfflineData();
  });

  test('queues idempotent mutations and removes only the completed entry', async () => {
    const first = await queueMutation({
      method: 'PATCH',
      path: `/api/orders/${order.orderId}/status`,
      body: { status: 'IN_PROGRESS' },
      idempotencyKey: 'offline-status-0001',
    });
    await queueMutation({
      method: 'PATCH',
      path: '/api/drivers/DRV-001/location',
      body: { lat: 10.77, lng: 106.7 },
      idempotencyKey: 'offline-location-0001',
    });

    expect(await getOutboxSize()).toBe(2);
    expect((await getQueuedMutations()).map((entry) => entry.idempotencyKey)).toEqual(
      expect.arrayContaining(['offline-status-0001', 'offline-location-0001']),
    );

    await removeQueuedMutation(first.id);
    const remaining = await getQueuedMutations();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.idempotencyKey).toBe('offline-location-0001');
  });

  test('updates the cached driver order without changing other cached orders', async () => {
    const second = { ...order, orderId: '00000000-0000-4000-8000-000000000002' };
    await cacheDriverOrders('DRV-001', [order, second]);
    await updateCachedOrder('DRV-001', { ...order, status: 'IN_PROGRESS' });

    const cached = await getCachedDriverOrders('DRV-001');
    expect(cached.map(({ orderId, status }) => ({ orderId, status }))).toEqual([
      { orderId: order.orderId, status: 'IN_PROGRESS' },
      { orderId: second.orderId, status: 'ASSIGNED' },
    ]);
  });
});
