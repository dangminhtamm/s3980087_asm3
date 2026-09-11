import axios from 'axios';

import { getAccessToken } from '../auth/CloudFleetAuth';
import { runtimeEnv } from '../config/runtime';
import { getOutboxSize, getQueuedMutations, removeQueuedMutation } from './offline-store';
import { sendFrontendTelemetry } from './telemetry';

const apiBaseUrl =
  runtimeEnv('VITE_API_BASE_URL') || 'http://localhost:3000';

export const cloudFleetApi = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

cloudFleetApi.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  config.headers.set('X-Request-ID', crypto.randomUUID());
  if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase() ?? '')) {
    if (!config.headers.has('Idempotency-Key')) {
      config.headers.set('Idempotency-Key', crypto.randomUUID());
    }
  }
  return config;
});

export const flushOfflineOutbox = async (): Promise<number> => {
  if (!navigator.onLine) return 0;
  const startedAt = performance.now();
  const queued = await getQueuedMutations();
  sendFrontendTelemetry({
    type: 'OFFLINE_OUTBOX', event: 'flush', size: queued.length,
    retryCount: 0, conflictCount: 0, completedCount: 0, durationMs: 0,
  });
  let completed = 0;
  let retryCount = 0;
  let conflictCount = 0;
  for (const mutation of queued) {
    try {
      await cloudFleetApi.request({
        method: mutation.method,
        url: mutation.path,
        data: mutation.body,
        headers: { 'Idempotency-Key': mutation.idempotencyKey },
      });
      await removeQueuedMutation(mutation.id);
      completed += 1;
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response && error.response.status < 500) {
        // Permanent validation/auth/conflict errors must not block newer events.
        if (error.response.status === 409) conflictCount += 1;
        await removeQueuedMutation(mutation.id);
        continue;
      }
      retryCount += 1;
      break;
    }
  }
  const size = await getOutboxSize();
  sendFrontendTelemetry({
    type: 'OFFLINE_OUTBOX', event: 'flush', size, retryCount, conflictCount,
    completedCount: completed, durationMs: performance.now() - startedAt,
  });
  window.dispatchEvent(new CustomEvent('cloudfleet:outbox-flushed', { detail: { completed } }));
  return completed;
};
