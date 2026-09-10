import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const apiBaseUrl = process.env.LOCAL_API_BASE_URL?.trim() || 'http://127.0.0.1:3000';

const apiRequest = (path: string, method = 'GET', body?: unknown) => fetch(`${apiBaseUrl}${path}`, {
  method,
  headers: {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ? { 'Idempotency-Key': randomUUID() }
      : {}),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('readiness verifies DynamoDB and S3', async () => {
  const response = await fetch(`${apiBaseUrl}/ready`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('x-request-id') ?? '', /^[A-Za-z0-9-]{8,}$/);
  const body = await response.json() as { status: string; dependencies: Record<string, string> };
  assert.equal(body.status, 'ready');
  assert.deepEqual(body.dependencies, { dynamodb: 'ready', s3: 'ready' });
});

test('same Idempotency-Key replays a create response and rejects changed input', async () => {
  const key = randomUUID();
  const requestId = randomUUID();
  const input = {
    customerName: `Integration ${Date.now()}`,
    customerPhone: '+84901234567',
    dropoffAddress: '72 Nguyen Hue Street, District 1, Ho Chi Minh City',
    region: 'District 1',
    lat: 10.77428,
    lng: 106.70391,
  };
  const send = (body: unknown) => fetch(`${apiBaseUrl}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
      'X-Request-ID': requestId,
    },
    body: JSON.stringify(body),
  });

  const first = await send(input);
  assert.equal(first.status, 201);
  assert.equal(first.headers.get('x-request-id'), requestId);
  const firstBody = await first.json() as { data: { orderId: string } };

  const replay = await send(input);
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  const replayBody = await replay.json() as { data: { orderId: string } };
  assert.equal(replayBody.data.orderId, firstBody.data.orderId);

  const conflict = await send({ ...input, customerName: 'Changed customer' });
  assert.equal(conflict.status, 409);
  const conflictBody = await conflict.json() as { error: { code: string; requestId: string } };
  assert.equal(conflictBody.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(conflictBody.error.requestId, requestId);
});

test('failed delivery can be rescheduled and releases its driver', async () => {
  const driversResponse = await apiRequest('/api/drivers?status=AVAILABLE');
  assert.equal(driversResponse.status, 200);
  const drivers = await driversResponse.json() as { data: Array<{ driverId: string }> };
  assert.ok(drivers.data[0]?.driverId, 'an available seeded driver is required');
  const driverId = drivers.data[0]!.driverId;

  const createResponse = await apiRequest('/api/orders', 'POST', {
    customerName: `Exception integration ${Date.now()}`,
    customerPhone: '+84901234567',
    dropoffAddress: '15 Vo Van Tan Street, District 3, Ho Chi Minh City',
    region: 'District 3',
    lat: 10.77712,
    lng: 106.68842,
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json() as { data: { orderId: string } };
  const orderId = created.data.orderId;

  const assigned = await apiRequest(`/api/orders/${orderId}/assign`, 'PATCH', { driverId });
  assert.equal(assigned.status, 200);
  assert.equal(((await assigned.json()) as { data: { status: string } }).data.status, 'ASSIGNED');

  const started = await apiRequest(`/api/orders/${orderId}/status`, 'PATCH', { status: 'IN_PROGRESS' });
  assert.equal(started.status, 200);

  const failed = await apiRequest(`/api/orders/${orderId}/status`, 'PATCH', {
    status: 'DELIVERY_FAILED',
    reason: 'CUSTOMER_UNAVAILABLE',
    notes: 'No answer at the destination',
  });
  assert.equal(failed.status, 200);
  const failedBody = await failed.json() as { data: { status: string; exception: { reason: string } } };
  assert.equal(failedBody.data.status, 'DELIVERY_FAILED');
  assert.equal(failedBody.data.exception.reason, 'CUSTOMER_UNAVAILABLE');

  const rescheduled = await apiRequest(`/api/orders/${orderId}/status`, 'PATCH', { status: 'RESCHEDULED' });
  assert.equal(rescheduled.status, 200);
  const rescheduledBody = await rescheduled.json() as { data: { status: string; driverId: string | null } };
  assert.equal(rescheduledBody.data.status, 'RESCHEDULED');
  assert.equal(rescheduledBody.data.driverId, null);

  const driverResponse = await apiRequest(`/api/drivers/${driverId}`);
  assert.equal(driverResponse.status, 200);
  assert.equal(((await driverResponse.json()) as { data: { status: string } }).data.status, 'AVAILABLE');
});

test('CSV import reports row errors and exports created orders', async () => {
  const csv = [
    'customerName,customerPhone,dropoffAddress,region,lat,lng,packageWeightKg,packageVolumeM3',
    `CSV ${Date.now()},+84901234567,"72 Nguyen Hue, District 1",District 1,10.77428,106.70391,1.5,0.02`,
    'Bad phone,123,1 Main Street,District 1,10.7,106.7,1,0.01',
  ].join('\n');
  const imported = await fetch(`${apiBaseUrl}/api/orders/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv', 'Idempotency-Key': randomUUID() },
    body: csv,
  });
  assert.equal(imported.status, 207);
  const result = await imported.json() as { data: { created: number; failed: number } };
  assert.deepEqual(result.data, { ...result.data, created: 1, failed: 1 });

  const exported = await fetch(`${apiBaseUrl}/api/orders/export.csv`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type') ?? '', /^text\/csv/);
  assert.match(await exported.text(), /packageWeightKg/);
});

test('multi-stop routes assign atomically and enforce vehicle capacity', async () => {
  const driverResponse = await apiRequest('/api/drivers', 'POST', {
    name: `Route Driver ${Date.now()}`, phone: '+84909998888', vehiclePlate: `RT-${String(Date.now()).slice(-6)}`,
    currentArea: 'District 1', maxWeightKg: 5, maxVolumeM3: 0.05,
  });
  assert.equal(driverResponse.status, 201);
  const driverId = ((await driverResponse.json()) as { data: { driverId: string } }).data.driverId;

  const createOrder = async (weight: number, volume: number) => {
    const response = await apiRequest('/api/orders', 'POST', {
      customerName: `Route Order ${randomUUID().slice(0, 5)}`, customerPhone: '+84901234567',
      dropoffAddress: '72 Nguyen Hue Street, District 1', region: 'District 1', lat: 10.77428, lng: 106.70391,
      packageWeightKg: weight, packageVolumeM3: volume, serviceDurationMinutes: 10,
    });
    assert.equal(response.status, 201);
    return ((await response.json()) as { data: { orderId: string } }).data.orderId;
  };
  const first = await createOrder(2, 0.02);
  const second = await createOrder(2, 0.02);
  const routeResponse = await apiRequest('/api/routes', 'POST', {
    driverId, orderIds: [first, second], scheduledDate: new Date().toISOString().slice(0, 10),
  });
  assert.equal(routeResponse.status, 201);
  const route = await routeResponse.json() as { data: { routeId: string; stopCount: number; plannedDistanceMeters: number; optimization: { revision: number }; stops: Array<{ orderId: string; sequence: number; plannedArrivalAt: string }> } };
  assert.equal(route.data.stopCount, 2);
  assert.deepEqual(route.data.stops.map((stop) => stop.sequence), [1, 2]);
  assert.ok(route.data.plannedDistanceMeters > 0);
  assert.equal(route.data.optimization.revision, 1);

  const reversed = [...route.data.stops].reverse().map((stop) => stop.orderId);
  const reordered = await apiRequest(`/api/routes/${route.data.routeId}/reorder`, 'PATCH', { orderIds: reversed });
  assert.equal(reordered.status, 200);
  const reorderedBody = await reordered.json() as { data: { optimization: { mode: string; revision: number }; stops: Array<{ orderId: string }> } };
  assert.equal(reorderedBody.data.optimization.mode, 'MANUAL');
  assert.equal(reorderedBody.data.optimization.revision, 2);
  assert.deepEqual(reorderedBody.data.stops.map((stop) => stop.orderId), reversed);

  const reoptimized = await apiRequest(`/api/routes/${route.data.routeId}/re-optimize`, 'POST', {});
  assert.equal(reoptimized.status, 200);
  assert.equal(((await reoptimized.json()) as { data: { optimization: { mode: string; revision: number } } }).data.optimization.revision, 3);

  const loaded = await fetch(`${apiBaseUrl}/api/routes/${route.data.routeId}`);
  assert.equal(loaded.status, 200);
  assert.equal(((await loaded.json()) as { data: { stops: unknown[] } }).data.stops.length, 2);

  const tooHeavy = await createOrder(3, 0.01);
  const rejected = await apiRequest('/api/routes', 'POST', {
    driverId, orderIds: [tooHeavy], scheduledDate: new Date().toISOString().slice(0, 10),
  });
  assert.equal(rejected.status, 409);
  assert.equal(((await rejected.json()) as { error: { code: string } }).error.code, 'VEHICLE_CAPACITY_EXCEEDED');
  const unchanged = await fetch(`${apiBaseUrl}/api/orders/${tooHeavy}`);
  assert.equal(((await unchanged.json()) as { data: { status: string } }).data.status, 'PENDING');
});
