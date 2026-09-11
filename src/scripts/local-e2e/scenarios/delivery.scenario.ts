import assert from 'node:assert/strict';
import type {
  ApiEnvelope,
  AnalyticsOverviewData,
  DeliveryProof,
  DriverDto,
  OrderDto,
  OrderEventDto,
  PresignedUpload,
  PublicTrackingData,
} from '../../../../packages/contracts/index.js';
import { LocalApiClient, logE2eStep } from '../api-client.js';
import { createAvailableDriver, newOrderFixture, proofPng } from '../fixtures.js';

export const runDeliveryScenario = async (api = new LocalApiClient()): Promise<string> => {
  await api.assertReady();
  logE2eStep('Backend health and dependencies are ready');

  const available = await api.request<ApiEnvelope<DriverDto[]>>('/api/drivers?status=AVAILABLE');
  const driver = available.data[0] ?? (await createAvailableDriver(api));
  assert.equal(driver.status, 'AVAILABLE');
  logE2eStep(`Selected available driver ${driver.driverId}`);

  const created = await api.request<ApiEnvelope<OrderDto>>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(newOrderFixture()),
  });
  assert.equal(created.data.status, 'PENDING');
  assert.equal(created.data.driverId, null);
  const orderId = created.data.orderId;
  logE2eStep(`Admin created pending order ${orderId}`);

  const trackingLink = await api.request<ApiEnvelope<{ url: string; expiresAt: string }>>(
    `/api/orders/${orderId}/tracking-link`,
  );
  const trackingToken = new URL(trackingLink.data.url).pathname.split('/').at(-1);
  assert.match(trackingToken ?? '', /^[A-Za-z0-9_-]{43}$/);
  assert.ok(new Date(trackingLink.data.expiresAt).getTime() > Date.now());
  const pendingTracking = await api.request<ApiEnvelope<PublicTrackingData>>(
    `/api/tracking/${trackingToken}`,
  );
  assert.equal(pendingTracking.data.status, 'PENDING');
  assert.doesNotMatch(JSON.stringify(pendingTracking.data), new RegExp(orderId));
  logE2eStep('Customer tracking token hides the internal order ID');

  const requestedStart = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const requestedEnd = new Date(Date.now() + 26 * 60 * 60_000).toISOString();
  const rescheduled = await api.request<ApiEnvelope<{ requestedWindowStart: string }>>(
    `/api/tracking/${trackingToken}/reschedule`,
    {
      method: 'POST',
      body: JSON.stringify({
        requestedWindowStart: requestedStart,
        requestedWindowEnd: requestedEnd,
        notes: 'Please deliver after reception opens',
      }),
    },
  );
  assert.equal(rescheduled.data.requestedWindowStart, requestedStart);
  const issues =
    await api.request<ApiEnvelope<Array<{ type: string; orderId: string }>>>(
      '/api/operations/issues',
    );
  assert.ok(
    issues.data.some(
      (issue) => issue.type === 'CUSTOMER_RESCHEDULE_REQUEST' && issue.orderId === orderId,
    ),
  );
  logE2eStep('Customer reschedule request appears in operations issues');

  const assigned = await api.request<ApiEnvelope<OrderDto>>(`/api/orders/${orderId}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ driverId: driver.driverId }),
  });
  assert.equal(assigned.data.driverId, driver.driverId);
  assert.equal(assigned.data.status, 'ASSIGNED');

  await api.request<ApiEnvelope<unknown>>(`/api/drivers/${driver.driverId}/location`, {
    method: 'PATCH',
    body: JSON.stringify({
      lat: 10.77405,
      lng: 106.70372,
      accuracy: 8,
      recordedAt: new Date().toISOString(),
    }),
  });
  logE2eStep('Order assignment and driver GPS update succeeded');

  const started = await api.request<ApiEnvelope<OrderDto>>(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'IN_PROGRESS' }),
  });
  assert.equal(started.data.status, 'IN_PROGRESS');
  const activeTracking = await api.request<ApiEnvelope<PublicTrackingData>>(
    `/api/tracking/${trackingToken}`,
  );
  assert.equal(activeTracking.data.status, 'IN_PROGRESS');
  assert.equal(activeTracking.data.driverApproaching, true);
  assert.ok((activeTracking.data.estimatedArrivalMinutes ?? 0) >= 2);
  assert.ok((activeTracking.data.distanceRemainingKm ?? 99) < 1.5);

  const driverQueue = await api.request<ApiEnvelope<OrderDto[]>>(
    `/api/orders?driverId=${encodeURIComponent(driver.driverId)}&status=IN_PROGRESS`,
  );
  assert.ok(driverQueue.data.some((order) => order.orderId === orderId));
  logE2eStep('Started order is visible in the driver queue and public tracking');

  const arrived = await api.request<ApiEnvelope<OrderDto>>(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ARRIVED' }),
  });
  assert.equal(arrived.data.status, 'ARRIVED');

  const upload = await api.request<ApiEnvelope<PresignedUpload>>(
    `/api/orders/${orderId}/proof/upload-url?contentType=image%2Fpng`,
  );
  assert.match(upload.data.objectKey, new RegExp(`^proof-of-delivery/${orderId}/`));
  const uploadResponse = await fetch(upload.data.uploadUrl, {
    method: 'PUT',
    headers: upload.data.requiredHeaders,
    body: proofPng,
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Proof upload returned HTTP ${uploadResponse.status}: ${await uploadResponse.text()}`,
    );
  }

  const proof = await api.request<ApiEnvelope<DeliveryProof>>(`/api/orders/${orderId}/proof`, {
    method: 'POST',
    body: JSON.stringify({
      objectKey: upload.data.objectKey,
      contentType: 'image/png',
      size: proofPng.byteLength,
      recipientName: 'E2E Recipient',
      signatureDataUrl: `data:image/png;base64,${proofPng.toString('base64')}`,
      barcode: 'CF-E2E-0001',
      notes: 'Parcel handed to recipient',
      gps: { lat: 10.77405, lng: 106.70372, accuracy: 8, recordedAt: new Date().toISOString() },
    }),
  });
  assert.equal(proof.data.orderId, orderId);
  assert.equal(proof.data.size, proofPng.byteLength);
  assert.equal(proof.data.barcode, 'CF-E2E-0001');
  logE2eStep('Proof bytes and metadata were stored');

  const delivered = await api.request<ApiEnvelope<OrderDto>>(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DELIVERED' }),
  });
  assert.equal(delivered.data.status, 'DELIVERED');
  assert.ok(delivered.data.deliveredAt);
  const deliveredTracking = await api.request<ApiEnvelope<PublicTrackingData>>(
    `/api/tracking/${trackingToken}`,
  );
  assert.equal(deliveredTracking.data.proof.confirmed, true);
  assert.equal(deliveredTracking.data.proof.signatureCaptured, true);
  assert.ok(deliveredTracking.data.timeline.some((event) => event.type === 'DELIVERY_COMPLETED'));

  const feedback = await api.request<ApiEnvelope<{ rating: number }>>(
    `/api/tracking/${trackingToken}/feedback`,
    { method: 'POST', body: JSON.stringify({ rating: 5, comment: 'Delivered with care' }) },
  );
  assert.equal(feedback.data.rating, 5);
  const trackingWithFeedback = await api.request<ApiEnvelope<PublicTrackingData>>(
    `/api/tracking/${trackingToken}`,
  );
  assert.equal(trackingWithFeedback.data.feedback?.rating, 5);

  const driverAfter = await api.request<ApiEnvelope<DriverDto>>(`/api/drivers/${driver.driverId}`);
  assert.equal(driverAfter.data.status, 'AVAILABLE');
  const storedProof = await api.request<ApiEnvelope<DeliveryProof>>(`/api/orders/${orderId}/proof`);
  assert.equal(storedProof.data.objectKey, upload.data.objectKey);

  const timeline = await api.request<ApiEnvelope<OrderEventDto[]>>(`/api/orders/${orderId}/events`);
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
  logE2eStep('Completion, feedback and lifecycle timeline are consistent');

  const view = await api.request<ApiEnvelope<{ viewUrl: string; expiresIn: number }>>(
    `/api/orders/${orderId}/proof/view-url`,
  );
  assert.equal(view.data.expiresIn, 300);
  const proofResponse = await fetch(view.data.viewUrl);
  assert.equal(proofResponse.status, 200);
  assert.equal((await proofResponse.arrayBuffer()).byteLength, proofPng.byteLength);

  const analytics =
    await api.request<ApiEnvelope<AnalyticsOverviewData>>('/api/analytics/overview');
  assert.equal(analytics.data.deliveryVolumeTrend.length, 30);
  assert.equal(analytics.data.hourlyOrderVolume.length, 24);
  assert.ok(analytics.data.totalOrders > 0);
  assert.ok(analytics.data.regions.every((region) => region.rankBySpeed !== null));
  const region = analytics.data.regions[0]?.region;
  assert.ok(region);
  const drilldown = await api.request<ApiEnvelope<AnalyticsOverviewData>>(
    `/api/analytics/overview?from=${analytics.data.period.from}&to=${analytics.data.period.to}&region=${encodeURIComponent(region)}`,
  );
  assert.equal(drilldown.data.selectedRegion, region);
  assert.equal(drilldown.data.deliveryVolumeTrend.length, 30);
  assert.ok(drilldown.data.totalOrders < analytics.data.totalOrders);
  logE2eStep('Proof view and analytics drilldown succeeded');

  return orderId;
};
