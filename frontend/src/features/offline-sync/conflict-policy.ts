import axios from 'axios';

export type SyncFailureDecision = 'discard-conflict' | 'discard-permanent' | 'retry-later';

export const decideSyncFailure = (error: unknown): SyncFailureDecision => {
  if (!axios.isAxiosError(error) || !error.response) return 'retry-later';
  if (error.response.status === 409) return 'discard-conflict';
  if (error.response.status < 500) return 'discard-permanent';
  return 'retry-later';
};
