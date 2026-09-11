import axios from 'axios';

import { runtimeEnv } from '../../config/runtime';
import type { DataResult } from '../../types/admin';

const enabled = import.meta.env.DEV && runtimeEnv('VITE_ENABLE_MOCK_FALLBACK') === 'true';

export const isNetworkFailure = (error: unknown): boolean =>
  axios.isAxiosError(error) && !error.response;

export const fallbackOrThrow = async <T>(
  error: unknown,
  fallback: () => T | Promise<T>,
): Promise<DataResult<T>> => {
  const canFallback =
    enabled &&
    axios.isAxiosError(error) &&
    (!error.response || error.response.status >= 500 || error.response.status === 404);
  if (!canFallback) throw error;
  return { data: await fallback(), isFallback: true };
};
