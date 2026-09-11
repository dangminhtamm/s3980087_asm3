import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { updateOrderStatus } from '../../orders/api/orders.client';
import type { AdminOrderStatus } from '../../../types/admin';
import { useDeliveryWorkflow } from './useDeliveryWorkflow';

vi.mock('../../orders/api/orders.client', () => ({ updateOrderStatus: vi.fn() }));
const updateStatus = vi.mocked(updateOrderStatus);

describe('driver delivery happy path', () => {
  beforeEach(() => updateStatus.mockResolvedValue({ data: {} as never, isFallback: false }));

  test('starts the route, records arrival and confirms a proof-backed delivery', async () => {
    const onStarted = vi.fn();
    const onArrived = vi.fn();
    const onDelivered = vi.fn();
    const { result, rerender } = renderHook(
      ({ status, registered }) =>
        useDeliveryWorkflow({
          orderId: 'ORDER-1',
          orderStatus: status,
          driverId: 'DRV-1',
          proofFile: null,
          proofRegistered: registered,
          phase: registered ? 'ready' : 'idle',
          isOnline: true,
          setPhase: vi.fn(),
          onFeedback: vi.fn(),
          onStarted,
          onArrived,
          onException: vi.fn(),
          onDelivered,
        }),
      { initialProps: { status: 'ASSIGNED' as AdminOrderStatus, registered: false } },
    );

    await act(() => result.current.startRoute());
    rerender({ status: 'IN_PROGRESS', registered: false });
    await act(() => result.current.recordArrival());
    rerender({ status: 'ARRIVED', registered: true });
    await act(() => result.current.confirmDelivery());

    expect(updateStatus.mock.calls.map((call) => call[1])).toEqual([
      'IN_PROGRESS',
      'ARRIVED',
      'DELIVERED',
    ]);
    expect(onStarted).toHaveBeenCalledWith('ORDER-1');
    expect(onArrived).toHaveBeenCalledWith('ORDER-1');
    expect(onDelivered).toHaveBeenCalledWith('ORDER-1');
  });
});
