import type { ApiEnvelope } from '../types/order';
import { cloudFleetApi } from './api';

const decodeVapidKey = (value: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return bytes as Uint8Array<ArrayBuffer>;
};

export const getPushSubscription = async (): Promise<PushSubscription | null> => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return (await navigator.serviceWorker.ready).pushManager.getSubscription();
};

export const enableDriverPush = async (driverId: string): Promise<PushSubscription> => {
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    throw new Error('Push notifications are not supported on this device.');
  }
  const keyResponse =
    await cloudFleetApi.get<ApiEnvelope<{ publicKey: string | null }>>('/api/push/public-key');
  if (!keyResponse.data.data.publicKey)
    throw new Error('Push notifications are not configured on this environment.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(keyResponse.data.data.publicKey),
  });
  await cloudFleetApi.post(
    `/api/drivers/${encodeURIComponent(driverId)}/push-subscriptions`,
    subscription.toJSON(),
  );
  return subscription;
};

export const disableDriverPush = async (driverId: string): Promise<void> => {
  const subscription = await getPushSubscription();
  if (!subscription) return;
  await cloudFleetApi.delete(`/api/drivers/${encodeURIComponent(driverId)}/push-subscriptions`, {
    data: { endpoint: subscription.endpoint },
  });
  await subscription.unsubscribe();
};
