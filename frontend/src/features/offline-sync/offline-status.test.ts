import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import type { AdminOrder } from '../../types/admin';
import { updateOrderStatus } from '../orders/api/orders.client';
import {
  cacheDriverOrders,
  clearOfflineData,
  getCachedDriverOrders,
  getQueuedMutations,
} from './index';

const server = setupServer(
  http.patch('http://localhost:3000/api/orders/:orderId/status', () => HttpResponse.error()),
);
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

describe('offline status update', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  beforeEach(async () => clearOfflineData());
  afterAll(() => server.close());

  test('updates cache and stores an idempotent mutation after a network failure', async () => {
    await cacheDriverOrders('DRV-001', [order]);
    const result = await updateOrderStatus(order.orderId, 'IN_PROGRESS', undefined, 'DRV-001');

    expect(result).toMatchObject({ isFallback: true, isQueued: true });
    expect((await getCachedDriverOrders('DRV-001'))[0]?.status).toBe('IN_PROGRESS');
    expect(await getQueuedMutations()).toEqual([
      expect.objectContaining({
        path: `/api/orders/${order.orderId}/status`,
        body: { status: 'IN_PROGRESS' },
      }),
    ]);
  });
});
