import type { AxiosInstance } from 'axios';

import { sendFrontendTelemetry } from '../../services/telemetry';
import { decideSyncFailure } from './conflict-policy';
import type { OfflineRepository } from './offline.types';

export interface SyncEnvironment {
  isOnline(): boolean;
  now(): number;
  notify(completed: number): void;
}

const browserEnvironment: SyncEnvironment = {
  isOnline: () => navigator.onLine,
  now: () => performance.now(),
  notify: (completed) =>
    window.dispatchEvent(new CustomEvent('cloudfleet:outbox-flushed', { detail: { completed } })),
};

export class OfflineSyncEngine {
  constructor(
    private readonly api: AxiosInstance,
    private readonly repository: OfflineRepository,
    private readonly environment: SyncEnvironment = browserEnvironment,
  ) {}

  async flush(): Promise<number> {
    if (!this.environment.isOnline()) return 0;
    const startedAt = this.environment.now();
    const queued = await this.repository.getQueuedMutations();
    let completed = 0;
    let retryCount = 0;
    let conflictCount = 0;

    for (const mutation of queued) {
      try {
        await this.api.request({
          method: mutation.method,
          url: mutation.path,
          data: mutation.body,
          headers: { 'Idempotency-Key': mutation.idempotencyKey },
        });
        await this.repository.removeQueuedMutation(mutation.id);
        completed += 1;
      } catch (error: unknown) {
        const decision = decideSyncFailure(error);
        if (decision === 'retry-later') {
          retryCount += 1;
          break;
        }
        if (decision === 'discard-conflict') conflictCount += 1;
        await this.repository.removeQueuedMutation(mutation.id);
      }
    }

    sendFrontendTelemetry({
      type: 'OFFLINE_OUTBOX',
      event: 'flush',
      size: await this.repository.getOutboxSize(),
      retryCount,
      conflictCount,
      completedCount: completed,
      durationMs: this.environment.now() - startedAt,
    });
    this.environment.notify(completed);
    return completed;
  }
}
