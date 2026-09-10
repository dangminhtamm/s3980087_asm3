import axios from 'axios';

import { getAccessToken } from '../auth/CloudFleetAuth';
import { runtimeEnv } from '../config/runtime';
import { getQueuedMutations, removeQueuedMutation } from './offline-store';

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
  const queued = await getQueuedMutations();
  let completed = 0;
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
        await removeQueuedMutation(mutation.id);
        continue;
      }
      break;
    }
  }
  window.dispatchEvent(new CustomEvent('cloudfleet:outbox-flushed', { detail: { completed } }));
  return completed;
};
