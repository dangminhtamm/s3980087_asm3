import type { AdminOrder } from '../types/admin';

const DATABASE_NAME = 'cloudfleet-driver';
const DATABASE_VERSION = 1;

export interface QueuedMutation {
  id: string;
  method: 'PATCH' | 'POST' | 'DELETE';
  path: string;
  body: unknown;
  idempotencyKey: string;
  createdAt: string;
}

export interface PendingProof {
  orderId: string;
  file: File;
  recipientName: string;
  signatureDataUrl: string | null;
  barcode: string;
  notes: string;
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains('orders')) database.createObjectStore('orders', { keyPath: 'driverId' });
    if (!database.objectStoreNames.contains('outbox')) database.createObjectStore('outbox', { keyPath: 'id' });
    if (!database.objectStoreNames.contains('proofs')) database.createObjectStore('proofs', { keyPath: 'orderId' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionComplete = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
});

export const cacheDriverOrders = async (driverId: string, orders: AdminOrder[]): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction('orders', 'readwrite');
  transaction.objectStore('orders').put({ driverId, orders, cachedAt: new Date().toISOString() });
  await transactionComplete(transaction);
};

export const getCachedDriverOrders = async (driverId: string): Promise<AdminOrder[]> => {
  const database = await openDatabase();
  const record = await requestResult<{ orders?: AdminOrder[] } | undefined>(database.transaction('orders').objectStore('orders').get(driverId));
  return Array.isArray(record?.orders) ? record.orders : [];
};

export const updateCachedOrder = async (driverId: string, updated: AdminOrder): Promise<void> => {
  const orders = await getCachedDriverOrders(driverId);
  await cacheDriverOrders(driverId, orders.map((order) => order.orderId === updated.orderId ? updated : order));
};

export const queueMutation = async (mutation: Omit<QueuedMutation, 'id' | 'createdAt'>): Promise<QueuedMutation> => {
  const queued: QueuedMutation = { ...mutation, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
  const database = await openDatabase();
  const transaction = database.transaction('outbox', 'readwrite');
  transaction.objectStore('outbox').put(queued);
  await transactionComplete(transaction);
  return queued;
};

export const getQueuedMutations = async (): Promise<QueuedMutation[]> => {
  const database = await openDatabase();
  const records = await requestResult<QueuedMutation[]>(database.transaction('outbox').objectStore('outbox').getAll());
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
};

export const removeQueuedMutation = async (id: string): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction('outbox', 'readwrite');
  transaction.objectStore('outbox').delete(id);
  await transactionComplete(transaction);
};

export const savePendingProof = async (proof: PendingProof): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction('proofs', 'readwrite');
  transaction.objectStore('proofs').put(proof);
  await transactionComplete(transaction);
};

export const getPendingProof = async (orderId: string): Promise<PendingProof | null> => {
  const database = await openDatabase();
  return (await requestResult<PendingProof | undefined>(database.transaction('proofs').objectStore('proofs').get(orderId))) ?? null;
};

export const removePendingProof = async (orderId: string): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction('proofs', 'readwrite');
  transaction.objectStore('proofs').delete(orderId);
  await transactionComplete(transaction);
};

export const clearOfflineData = async (): Promise<void> => {
  const database = await openDatabase();
  const transaction = database.transaction(['orders', 'outbox', 'proofs'], 'readwrite');
  transaction.objectStore('orders').clear();
  transaction.objectStore('outbox').clear();
  transaction.objectStore('proofs').clear();
  await transactionComplete(transaction);
};
