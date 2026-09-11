import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { clearOfflineData, savePendingProof } from '../../offline-sync';
import { useProofOfDelivery } from './useProofOfDelivery';

describe('POD draft recovery', () => {
  beforeEach(async () => clearOfflineData());

  test('restores photo metadata from IndexedDB after remount', async () => {
    const file = new File(['proof'], 'doorstep.jpg', { type: 'image/jpeg' });
    await savePendingProof({
      orderId: 'ORDER-1',
      file,
      recipientName: 'Lan Anh',
      signatureDataUrl: null,
      barcode: 'PKG-1',
      notes: 'At reception',
    });
    const feedback = vi.fn();

    const { result } = renderHook(() =>
      useProofOfDelivery({
        orderId: 'ORDER-1',
        orderStatus: 'IN_PROGRESS',
        customerName: 'Customer',
        isOnline: false,
        locationTracking: {
          status: 'idle',
          lastUpdatedAt: null,
          lastLocation: null,
          retry: vi.fn(),
        },
        onFeedback: feedback,
      }),
    );

    await waitFor(() => expect(result.current.recipientName).toBe('Lan Anh'));
    expect(result.current.proofFile).not.toBeNull();
    expect(result.current.barcode).toBe('PKG-1');
    expect(result.current.notes).toBe('At reception');
    expect(feedback).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Recovered') }),
    );
    await act(async () => undefined);
  });
});
