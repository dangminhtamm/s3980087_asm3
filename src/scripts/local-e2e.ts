import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const apiBaseUrl = process.env.LOCAL_API_BASE_URL?.trim() || 'http://localhost:3000';

interface ApiEnvelope<T> {
  data: T;
}

interface ApiErrorEnvelope {
  error?: { code?: string; message?: string };
}

type OrderStatus = 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'ARRIVED' | 'DELIVERED';

interface Order {
  orderId: string;
  customerName: string;
  customerPhone: string;
  dropoffAddress: string;
  region: string;
  lat: number;
  lng: number;
  status: OrderStatus;
  driverId: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

interface Driver {
  driverId: string;
  status: 'AVAILABLE' | 'ON_DELIVERY' | 'OFFLINE';
}

interface PresignedUpload {
  uploadUrl: string;
  objectKey: string;
  requiredHeaders: Record<string, string>;
}

interface DeliveryProof {
  orderId: string;
  objectKey: string;
  size: number;
  recipientName: string | null;
  signatureDataUrl: string | null;
  barcode: string | null;
  notes: string | null;
  gps: { lat: number; lng: number; accuracy: number | null; recordedAt: string } | null;
}

interface OrderEvent {
  eventId: string;
  type: string;
  source: 'RECORDED' | 'DERIVED';
}

interface ProofViewUrl {
  viewUrl: string;
  expiresIn: number;
}

interface AnalyticsOverview {
  coverage: { from: string; to: string };
  period: { from: string; to: string };
  selectedRegion: string | null;
  totalOrders: number;
  comparison: {
    previousPeriod: { from: string; to: string };
    totalOrdersChangePercent: number | null;
  };
  deliveryVolumeTrend: Array<{ date: string; orderCount: number }>;
  hourlyOrderVolume: Array<{ hour: number; orderCount: number }>;
  regions: Array<{ region: string; rankBySpeed: number | null; isAbnormal: boolean }>;
}

interface TrackingLink {
  url: string;
  expiresAt: string;
}

interface PublicTracking {
  reference: string;
  status: OrderStatus;
  driverApproaching: boolean;
  estimatedArrivalMinutes: number | null;
  distanceRemainingKm: number | null;
  proof: { confirmed: boolean; uploadedAt: string | null; recipientName: string | null; signatureCaptured: boolean };
  feedback: { rating: number; comment: string | null; submittedAt: string } | null;
  rescheduleRequest: { requestedWindowStart: string; requestedWindowEnd: string; requestedAt: string } | null;
  timeline: Array<{ type: string; occurredAt: string }>;
}

const request = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(init?.method ?? '')
        ? { 'Idempotency-Key': randomUUID() }
        : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let providerMessage = '';
    try {
      const body = (await response.json()) as ApiErrorEnvelope;
      providerMessage = body.error?.message ? `: ${body.error.message}` : '';
    } catch {
      // The status code remains enough context for a non-JSON failure.
    }
    throw new Error(`${init?.method ?? 'GET'} ${path} returned ${response.status}${providerMessage}`);
  }

  return (await response.json()) as T;
};

const logStep = (message: string): void => console.info(`✓ ${message}`);

const createAvailableDriver = async (): Promise<Driver> => {
  const suffix = Date.now().toString().slice(-6);
  const response = await request<ApiEnvelope<Driver>>('/api/drivers', {
    method: 'POST',
    body: JSON.stringify({
      name: `E2E Driver ${suffix}`,
      phone: `+8491${suffix}00`,
      vehiclePlate: `E2E-${suffix}`,
      currentArea: 'District 1',
    }),
  });
  return response.data;
};

const main = async (): Promise<void> => {
  const healthResponse = await fetch(`${apiBaseUrl}/health`);
  assert.equal(healthResponse.status, 200, 'Backend health check must return HTTP 200');
  logStep('Backend is healthy');
  const readyResponse = await fetch(`${apiBaseUrl}/ready`);
  assert.equal(readyResponse.status, 200, 'Backend readiness check must return HTTP 200');
  logStep('DynamoDB and S3 dependencies are ready');

  const availableDrivers = await request<ApiEnvelope<Driver[]>>(
    '/api/drivers?status=AVAILABLE',
  );
  const driver = availableDrivers.data[0] ?? await createAvailableDriver();
  assert.equal(driver.status, 'AVAILABLE');
  logStep(`Selected available driver ${driver.driverId}`);

  const created = await request<ApiEnvelope<Order>>('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      customerName: `E2E Customer ${Date.now()}`,
      customerPhone: '+84901234567',
      dropoffAddress: '72 Nguyen Hue Street, District 1, Ho Chi Minh City',
      region: 'District 1',
      lat: 10.77428,
      lng: 106.70391,
    }),
  });
  assert.equal(created.data.status, 'PENDING');
  assert.equal(created.data.driverId, null);
  logStep(`Admin created pending order ${created.data.orderId}`);

  const trackingLink = await request<ApiEnvelope<TrackingLink>>(
    `/api/orders/${created.data.orderId}/tracking-link`,
  );
  const trackingToken = new URL(trackingLink.data.url).pathname.split('/').at(-1);
  assert.match(trackingToken ?? '', /^[A-Za-z0-9_-]{43}$/);
  assert.ok(new Date(trackingLink.data.expiresAt).getTime() > Date.now());
  const pendingTracking = await request<ApiEnvelope<PublicTracking>>(
    `/api/tracking/${trackingToken}`,
  );
  assert.equal(pendingTracking.data.status, 'PENDING');
  assert.doesNotMatch(JSON.stringify(pendingTracking.data), new RegExp(created.data.orderId));
  logStep('Customer tracking uses an expiring capability token and hides orderId');

  const requestedStart = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const requestedEnd = new Date(Date.now() + 26 * 60 * 60_000).toISOString();
  const rescheduled = await request<ApiEnvelope<{ requestedWindowStart: string }>>(
    `/api/tracking/${trackingToken}/reschedule`,
    { method: 'POST', body: JSON.stringify({ requestedWindowStart: requestedStart, requestedWindowEnd: requestedEnd, notes: 'Please deliver after reception opens' }) },
  );
  assert.equal(rescheduled.data.requestedWindowStart, requestedStart);
  const issues = await request<ApiEnvelope<Array<{ type: string; orderId: string }>>>('/api/operations/issues');
  assert.ok(issues.data.some((issue) => issue.type === 'CUSTOMER_RESCHEDULE_REQUEST' && issue.orderId === created.data.orderId));
  logStep('Customer reschedule request appears in the operations exception queue');

  const assigned = await request<ApiEnvelope<Order>>(
    `/api/orders/${created.data.orderId}/assign`,
    {
      method: 'PATCH',
      body: JSON.stringify({ driverId: driver.driverId }),
    },
  );
  assert.equal(assigned.data.driverId, driver.driverId);
  assert.equal(assigned.data.status, 'ASSIGNED');
  logStep('Admin assigned the order to the driver');

  await request<ApiEnvelope<unknown>>(`/api/drivers/${driver.driverId}/location`, {
    method: 'PATCH',
    body: JSON.stringify({
      lat: 10.77405,
      lng: 106.70372,
      accuracy: 8,
      recordedAt: new Date().toISOString(),
    }),
  });
  logStep('Driver published a fresh location near the destination');

  const started = await request<ApiEnvelope<Order>>(
    `/api/orders/${created.data.orderId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'IN_PROGRESS' }),
    },
  );
  assert.equal(started.data.status, 'IN_PROGRESS');
  logStep('Admin started the delivery');

  const activeTracking = await request<ApiEnvelope<PublicTracking>>(
    `/api/tracking/${trackingToken}`,
  );
  assert.equal(activeTracking.data.status, 'IN_PROGRESS');
  assert.equal(activeTracking.data.driverApproaching, true);
  assert.ok((activeTracking.data.estimatedArrivalMinutes ?? 0) >= 2);
  assert.ok((activeTracking.data.distanceRemainingKm ?? 99) < 1.5);
  logStep('Customer sees a live approaching indicator and ETA');

  const driverQueue = await request<ApiEnvelope<Order[]>>(
    `/api/orders?driverId=${encodeURIComponent(driver.driverId)}&status=IN_PROGRESS`,
  );
  assert.ok(
    driverQueue.data.some((order) => order.orderId === created.data.orderId),
    'The started order must be visible in the driver queue',
  );
  logStep('Driver can read the assigned in-progress order');

  const arrived = await request<ApiEnvelope<Order>>(
    `/api/orders/${created.data.orderId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ARRIVED' }),
    },
  );
  assert.equal(arrived.data.status, 'ARRIVED');
  logStep('Driver recorded arrival before collecting proof');

  const upload = await request<ApiEnvelope<PresignedUpload>>(
    `/api/orders/${created.data.orderId}/proof/upload-url?contentType=image%2Fpng`,
  );
  assert.match(upload.data.objectKey, new RegExp(`^proof-of-delivery/${created.data.orderId}/`));

  // A valid 1x1 transparent PNG keeps the test deterministic and tiny.
  const proofBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const uploadResponse = await fetch(upload.data.uploadUrl, {
    method: 'PUT',
    headers: upload.data.requiredHeaders,
    body: proofBytes,
  });
  if (!uploadResponse.ok) {
    const storageMessage = await uploadResponse.text();
    throw new Error(
      `Proof upload returned HTTP ${uploadResponse.status}: ${storageMessage}`,
    );
  }
  logStep('Driver uploaded proof directly to S3-compatible storage');

  const proof = await request<ApiEnvelope<DeliveryProof>>(
    `/api/orders/${created.data.orderId}/proof`,
    {
      method: 'POST',
      body: JSON.stringify({
        objectKey: upload.data.objectKey,
        contentType: 'image/png',
        size: proofBytes.byteLength,
        recipientName: 'E2E Recipient',
        signatureDataUrl: `data:image/png;base64,${proofBytes.toString('base64')}`,
        barcode: 'CF-E2E-0001',
        notes: 'Parcel handed to recipient',
        gps: { lat: 10.77405, lng: 106.70372, accuracy: 8, recordedAt: new Date().toISOString() },
      }),
    },
  );
  assert.equal(proof.data.orderId, created.data.orderId);
  assert.equal(proof.data.size, proofBytes.byteLength);
  assert.equal(proof.data.recipientName, 'E2E Recipient');
  assert.equal(proof.data.barcode, 'CF-E2E-0001');
  assert.equal(proof.data.gps?.accuracy, 8);
  logStep('Backend verified the object and stored proof metadata');

  const delivered = await request<ApiEnvelope<Order>>(
    `/api/orders/${created.data.orderId}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'DELIVERED' }),
    },
  );
  assert.equal(delivered.data.status, 'DELIVERED');
  assert.ok(delivered.data.deliveredAt);
  logStep('Driver completed the delivery');

  const deliveredTracking = await request<ApiEnvelope<PublicTracking>>(
    `/api/tracking/${trackingToken}`,
  );
  assert.equal(deliveredTracking.data.status, 'DELIVERED');
  assert.equal(deliveredTracking.data.proof.confirmed, true);
  assert.equal(deliveredTracking.data.proof.signatureCaptured, true);
  assert.equal(deliveredTracking.data.proof.recipientName, 'E2E Recipient');
  assert.ok(deliveredTracking.data.timeline.some((event) => event.type === 'DELIVERY_COMPLETED'));
  logStep('Customer sees delivery completion and Proof of Delivery confirmation');

  const feedback = await request<ApiEnvelope<{ rating: number }>>(`/api/tracking/${trackingToken}/feedback`, {
    method: 'POST', body: JSON.stringify({ rating: 5, comment: 'Delivered with care' }),
  });
  assert.equal(feedback.data.rating, 5);
  const trackingWithFeedback = await request<ApiEnvelope<PublicTracking>>(`/api/tracking/${trackingToken}`);
  assert.equal(trackingWithFeedback.data.feedback?.rating, 5);
  logStep('Customer submitted a verified post-delivery rating');

  const driverAfterDelivery = await request<ApiEnvelope<Driver>>(
    `/api/drivers/${driver.driverId}`,
  );
  assert.equal(driverAfterDelivery.data.status, 'AVAILABLE');
  logStep('Delivery transaction returned the driver to AVAILABLE');

  const storedProof = await request<ApiEnvelope<DeliveryProof>>(
    `/api/orders/${created.data.orderId}/proof`,
  );
  assert.equal(storedProof.data.objectKey, upload.data.objectKey);
  logStep('Proof metadata remains queryable after completion');

  const timeline = await request<ApiEnvelope<OrderEvent[]>>(
    `/api/orders/${created.data.orderId}/events`,
  );
  assert.deepEqual(
    timeline.data.map((event) => event.type),
    [
      'ORDER_CREATED',
      'CUSTOMER_RESCHEDULE_REQUESTED',
      'DRIVER_ASSIGNED',
      'DELIVERY_STARTED',
      'DRIVER_ARRIVED',
      'PROOF_UPLOADED',
      'DELIVERY_COMPLETED',
      'CUSTOMER_FEEDBACK_RECEIVED',
    ],
  );
  assert.ok(timeline.data.every((event) => event.source === 'RECORDED'));
  logStep('Order lifecycle timeline contains every recorded transition');

  const view = await request<ApiEnvelope<ProofViewUrl>>(
    `/api/orders/${created.data.orderId}/proof/view-url`,
  );
  assert.equal(view.data.expiresIn, 300);
  const proofResponse = await fetch(view.data.viewUrl);
  assert.equal(proofResponse.status, 200);
  assert.equal((await proofResponse.arrayBuffer()).byteLength, proofBytes.byteLength);
  logStep('Admin can read proof through a short-lived signed URL');

  const analytics = await request<ApiEnvelope<AnalyticsOverview>>('/api/analytics/overview');
  assert.equal(analytics.data.deliveryVolumeTrend.length, 30);
  assert.equal(analytics.data.hourlyOrderVolume.length, 24);
  assert.ok(analytics.data.totalOrders > 0);
  assert.ok(analytics.data.regions.every((region) => region.rankBySpeed !== null));
  logStep('Analytics API aggregates a real 30-day range and previous period');

  const drilldownRegion = analytics.data.regions[0]?.region;
  assert.ok(drilldownRegion);
  const drilldown = await request<ApiEnvelope<AnalyticsOverview>>(
    `/api/analytics/overview?from=${analytics.data.period.from}&to=${analytics.data.period.to}&region=${encodeURIComponent(drilldownRegion)}`,
  );
  assert.equal(drilldown.data.selectedRegion, drilldownRegion);
  assert.equal(drilldown.data.deliveryVolumeTrend.length, 30);
  assert.ok(drilldown.data.totalOrders < analytics.data.totalOrders);
  logStep(`Analytics API drills into ${drilldownRegion} without rescanning DynamoDB`);

  console.info(`\nCloudFleet local E2E passed for order ${created.data.orderId}`);
};

main().catch((error: unknown) => {
  console.error('\nCloudFleet local E2E failed', error);
  process.exitCode = 1;
});
