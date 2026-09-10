export interface DriverPushSubscriptionInput {
  endpoint: string;
  expirationTime?: number | null | undefined;
  keys: { p256dh: string; auth: string };
}

export interface DriverPushSubscription extends DriverPushSubscriptionInput {
  driverId: string;
  subscriptionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DriverPushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}
