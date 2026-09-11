import { sendFrontendTelemetry } from '../../services/telemetry';
import type { AdminOrder } from '../../types/admin';
import type {
  CachedDriverOrders,
  OfflineRepository,
  PendingProof,
  QueuedMutation,
} from './offline.types';

const DATABASE_NAME = 'cloudfleet-driver';
const DATABASE_VERSION = 1;

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('orders'))
        database.createObjectStore('orders', { keyPath: 'driverId' });
      if (!database.objectStoreNames.contains('outbox'))
        database.createObjectStore('outbox', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('proofs'))
        database.createObjectStore('proofs', { keyPath: 'orderId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const resultOf = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const completed = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });

export class IndexedDbOfflineRepository implements OfflineRepository {
  async cacheDriverOrders(driverId: string, orders: AdminOrder[]): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction('orders', 'readwrite');
    transaction.objectStore('orders').put({
      driverId,
      orders,
      cachedAt: new Date().toISOString(),
    } satisfies CachedDriverOrders);
    await completed(transaction);
  }

  async getCachedDriverOrders(driverId: string): Promise<AdminOrder[]> {
    const database = await openDatabase();
    const record = await resultOf<CachedDriverOrders | undefined>(
      database.transaction('orders').objectStore('orders').get(driverId),
    );
    return Array.isArray(record?.orders) ? record.orders : [];
  }

  async updateCachedOrder(driverId: string, updated: AdminOrder): Promise<void> {
    const orders = await this.getCachedDriverOrders(driverId);
    await this.cacheDriverOrders(
      driverId,
      orders.map((order) => (order.orderId === updated.orderId ? updated : order)),
    );
  }

  async queueMutation(mutation: Omit<QueuedMutation, 'id' | 'createdAt'>): Promise<QueuedMutation> {
    const queued: QueuedMutation = {
      ...mutation,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const database = await openDatabase();
    const transaction = database.transaction('outbox', 'readwrite');
    transaction.objectStore('outbox').put(queued);
    await completed(transaction);
    sendFrontendTelemetry({
      type: 'OFFLINE_OUTBOX',
      event: 'queued',
      size: await this.getOutboxSize(),
      retryCount: 0,
      conflictCount: 0,
      completedCount: 0,
      durationMs: 0,
    });
    return queued;
  }

  async getQueuedMutations(): Promise<QueuedMutation[]> {
    const database = await openDatabase();
    const records = await resultOf<QueuedMutation[]>(
      database.transaction('outbox').objectStore('outbox').getAll(),
    );
    return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async getOutboxSize(): Promise<number> {
    const database = await openDatabase();
    return resultOf(database.transaction('outbox').objectStore('outbox').count());
  }

  async removeQueuedMutation(id: string): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction('outbox', 'readwrite');
    transaction.objectStore('outbox').delete(id);
    await completed(transaction);
  }

  async savePendingProof(proof: PendingProof): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction('proofs', 'readwrite');
    transaction.objectStore('proofs').put(proof);
    await completed(transaction);
  }

  async getPendingProof(orderId: string): Promise<PendingProof | null> {
    const database = await openDatabase();
    return (
      (await resultOf<PendingProof | undefined>(
        database.transaction('proofs').objectStore('proofs').get(orderId),
      )) ?? null
    );
  }

  async removePendingProof(orderId: string): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction('proofs', 'readwrite');
    transaction.objectStore('proofs').delete(orderId);
    await completed(transaction);
  }

  async clear(): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(['orders', 'outbox', 'proofs'], 'readwrite');
    transaction.objectStore('orders').clear();
    transaction.objectStore('outbox').clear();
    transaction.objectStore('proofs').clear();
    await completed(transaction);
  }
}

export const offlineRepository = new IndexedDbOfflineRepository();
