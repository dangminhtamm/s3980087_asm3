import { AxiosError, AxiosHeaders, type AxiosInstance } from 'axios';
import { describe, expect, test, vi } from 'vitest';

import { decideSyncFailure } from './conflict-policy';
import type { OfflineRepository, QueuedMutation } from './offline.types';
import { OfflineSyncEngine, type SyncEnvironment } from './sync-engine';

const queued: QueuedMutation = {
  id: 'MUTATION-1',
  method: 'PATCH',
  path: '/api/orders/ORDER-1/status',
  body: { status: 'IN_PROGRESS' },
  idempotencyKey: 'IDEMPOTENCY-1',
  createdAt: '2026-09-12T00:00:00.000Z',
};

const createHarness = (request: ReturnType<typeof vi.fn>) => {
  const repository = {
    getQueuedMutations: vi.fn().mockResolvedValue([queued]),
    removeQueuedMutation: vi.fn().mockResolvedValue(undefined),
    getOutboxSize: vi.fn().mockResolvedValue(0),
  } as unknown as OfflineRepository;
  const environment: SyncEnvironment = {
    isOnline: () => true,
    now: vi.fn().mockReturnValueOnce(10).mockReturnValue(25),
    notify: vi.fn(),
  };
  const api = { request } as unknown as AxiosInstance;
  return { engine: new OfflineSyncEngine(api, repository, environment), repository, environment };
};

describe('offline sync engine', () => {
  test('replays and removes a completed mutation with its idempotency key', async () => {
    const request = vi.fn().mockResolvedValue({});
    const { engine, repository, environment } = createHarness(request);
    await expect(engine.flush()).resolves.toBe(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { 'Idempotency-Key': 'IDEMPOTENCY-1' } }),
    );
    expect(repository.removeQueuedMutation).toHaveBeenCalledWith('MUTATION-1');
    expect(environment.notify).toHaveBeenCalledWith(1);
  });

  test('discards conflicts but keeps transient failures for retry', async () => {
    const conflict = new AxiosError('conflict', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status: 409,
      statusText: 'Conflict',
      headers: {},
      config: { headers: new AxiosHeaders() },
      data: {},
    });
    const conflictHarness = createHarness(vi.fn().mockRejectedValue(conflict));
    await expect(conflictHarness.engine.flush()).resolves.toBe(0);
    expect(conflictHarness.repository.removeQueuedMutation).toHaveBeenCalledWith('MUTATION-1');

    const retryHarness = createHarness(vi.fn().mockRejectedValue(new AxiosError('offline')));
    await expect(retryHarness.engine.flush()).resolves.toBe(0);
    expect(retryHarness.repository.removeQueuedMutation).not.toHaveBeenCalled();
  });

  test('does not inspect the repository while offline', async () => {
    const harness = createHarness(vi.fn());
    harness.environment.isOnline = () => false;
    await expect(harness.engine.flush()).resolves.toBe(0);
    expect(harness.repository.getQueuedMutations).not.toHaveBeenCalled();
  });
});

describe('conflict policy', () => {
  test('classifies permanent and retryable failures', () => {
    const response = (status: number) =>
      new AxiosError('error', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status,
        statusText: 'Error',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {},
      });
    expect(decideSyncFailure(response(400))).toBe('discard-permanent');
    expect(decideSyncFailure(response(409))).toBe('discard-conflict');
    expect(decideSyncFailure(response(503))).toBe('retry-later');
    expect(decideSyncFailure(new Error('unknown'))).toBe('retry-later');
  });
});
