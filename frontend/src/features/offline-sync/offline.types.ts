import type { AdminOrder } from '../../types/admin';

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

export interface CachedDriverOrders {
  driverId: string;
  orders: AdminOrder[];
  cachedAt: string;
}

export interface OfflineRepository {
  cacheDriverOrders(driverId: string, orders: AdminOrder[]): Promise<void>;
  getCachedDriverOrders(driverId: string): Promise<AdminOrder[]>;
  updateCachedOrder(driverId: string, order: AdminOrder): Promise<void>;
  queueMutation(mutation: Omit<QueuedMutation, 'id' | 'createdAt'>): Promise<QueuedMutation>;
  getQueuedMutations(): Promise<QueuedMutation[]>;
  getOutboxSize(): Promise<number>;
  removeQueuedMutation(id: string): Promise<void>;
  savePendingProof(proof: PendingProof): Promise<void>;
  getPendingProof(orderId: string): Promise<PendingProof | null>;
  removePendingProof(orderId: string): Promise<void>;
  clear(): Promise<void>;
}
