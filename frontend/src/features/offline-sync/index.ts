import { cloudFleetApi } from '../../shared/api/http-client';
import { offlineRepository } from './indexed-db.repository';
import { OfflineSyncEngine } from './sync-engine';

export type { OfflineRepository, PendingProof, QueuedMutation } from './offline.types';
export { IndexedDbOfflineRepository, offlineRepository } from './indexed-db.repository';
export { OfflineSyncEngine } from './sync-engine';
export { decideSyncFailure } from './conflict-policy';

export const cacheDriverOrders = offlineRepository.cacheDriverOrders.bind(offlineRepository);
export const getCachedDriverOrders =
  offlineRepository.getCachedDriverOrders.bind(offlineRepository);
export const updateCachedOrder = offlineRepository.updateCachedOrder.bind(offlineRepository);
export const queueMutation = offlineRepository.queueMutation.bind(offlineRepository);
export const getQueuedMutations = offlineRepository.getQueuedMutations.bind(offlineRepository);
export const getOutboxSize = offlineRepository.getOutboxSize.bind(offlineRepository);
export const removeQueuedMutation = offlineRepository.removeQueuedMutation.bind(offlineRepository);
export const savePendingProof = offlineRepository.savePendingProof.bind(offlineRepository);
export const getPendingProof = offlineRepository.getPendingProof.bind(offlineRepository);
export const removePendingProof = offlineRepository.removePendingProof.bind(offlineRepository);
export const clearOfflineData = offlineRepository.clear.bind(offlineRepository);

const syncEngine = new OfflineSyncEngine(cloudFleetApi, offlineRepository);
export const flushOfflineOutbox = (): Promise<number> => syncEngine.flush();
