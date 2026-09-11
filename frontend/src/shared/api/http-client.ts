import axios from 'axios';

import { getAccessToken } from '../../auth/CloudFleetAuth';
import { runtimeEnv } from '../../config/runtime';

const apiBaseUrl = runtimeEnv('VITE_API_BASE_URL') || 'http://localhost:3000';

export const cloudFleetApi = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

cloudFleetApi.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  config.headers.set('X-Request-ID', crypto.randomUUID());
  if (['post', 'put', 'patch', 'delete'].includes(config.method?.toLowerCase() ?? '')) {
    if (!config.headers.has('Idempotency-Key'))
      config.headers.set('Idempotency-Key', crypto.randomUUID());
  }
  return config;
});
