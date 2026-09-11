import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const budget = JSON.parse(open('../../performance-budget.json'));
const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const vus = Number(__ENV.USERS || '50');
const duration = __ENV.TEST_DURATION || '60s';
const authToken = __ENV.AUTH_TOKEN || '';

const errors = new Rate('cloudfleet_flow_errors');
const flowRequests = new Counter('cloudfleet_flow_requests');
const getOrdersDuration = new Trend('flow_get_orders_duration', true);
const trackingDuration = new Trend('flow_tracking_refresh_duration', true);
const gpsDuration = new Trend('flow_gps_update_duration', true);
const mutationDuration = new Trend('flow_assign_status_mutation_duration', true);
const issuesDuration = new Trend('flow_operations_issues_duration', true);

const thresholds = {
  cloudfleet_flow_errors: [`rate<${budget.errorRate}`],
  http_req_duration: [`p(95)<${budget.httpP95Ms}`, `p(99)<${budget.httpP99Ms}`],
  flow_get_orders_duration: [`p(95)<${budget.flows.get_orders.p95Ms}`],
  flow_tracking_refresh_duration: [`p(95)<${budget.flows.tracking_refresh.p95Ms}`],
  flow_gps_update_duration: [`p(95)<${budget.flows.gps_update.p95Ms}`],
  flow_assign_status_mutation_duration: [`p(95)<${budget.flows.assign_status_mutation.p95Ms}`],
  flow_operations_issues_duration: [`p(95)<${budget.flows.operations_issues.p95Ms}`],
};

export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus,
      duration,
      gracefulStop: '10s',
    },
  },
  thresholds: __ENV.K6_ENFORCE_THRESHOLDS === 'false' ? {} : thresholds,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

const headers = (mutation = false, suffix = '') => ({
  'Content-Type': 'application/json',
  'X-Request-ID': `k6-${vus}-${typeof __VU === 'undefined' ? 0 : __VU}-${typeof __ITER === 'undefined' ? 0 : __ITER}-${suffix || 'request'}`,
  ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  ...(mutation ? { 'Idempotency-Key': `k6-${vus}-${typeof __VU === 'undefined' ? 0 : __VU}-${typeof __ITER === 'undefined' ? 0 : __ITER}-${suffix}-${Math.random()}` } : {}),
});

const jsonData = (response) => {
  try { return response.json('data'); } catch (_) { return null; }
};

const batchChunks = (requests, size = 20) => {
  const responses = [];
  for (let offset = 0; offset < requests.length; offset += size) {
    responses.push(...http.batch(requests.slice(offset, offset + size)));
  }
  return responses;
};

export function setup() {
  const driverRequests = [];
  for (let index = 0; index < vus; index += 1) {
    const phoneSuffix = String((vus * 1000 + index) % 10_000_000).padStart(7, '0');
    driverRequests.push({
      method: 'POST', url: `${baseUrl}/api/drivers`,
      body: JSON.stringify({
        name: `k6 driver ${vus}-${index}`,
        phone: `+849${phoneSuffix}`,
        vehiclePlate: `K6-${vus}-${index}`,
        currentArea: 'Load test', maxWeightKg: 1000, maxVolumeM3: 10,
      }),
      params: { headers: { ...headers(true, `setup-driver-${index}`), 'Idempotency-Key': `k6-${vus}-driver-${index}-${Date.now()}` }, tags: { endpoint: 'setup_driver' } },
    });
  }
  const driverResponses = batchChunks(driverRequests);
  const drivers = driverResponses.map(jsonData).filter(Boolean);
  if (drivers.length !== vus) throw new Error(`Setup created ${drivers.length}/${vus} drivers`);

  const lifecycleCount = Math.max(1, Math.ceil(vus / 5));
  const orderRequests = [];
  for (let index = 0; index < lifecycleCount; index += 1) {
    orderRequests.push({
      method: 'POST', url: `${baseUrl}/api/orders`,
      body: JSON.stringify({
        customerName: `k6 customer ${vus}-${index}`,
        customerPhone: `+848${String((vus * 1000 + index) % 10_000_000).padStart(7, '0')}`,
        dropoffAddress: `${index + 1} Load Test Street, Ho Chi Minh City`,
        region: 'Load test', lat: 10.7769 + index * 0.00001,
        lng: 106.7009 + index * 0.00001, packageWeightKg: 1,
        packageVolumeM3: 0.01, serviceDurationMinutes: 5,
      }),
      params: { headers: { ...headers(true, `setup-order-${index}`), 'Idempotency-Key': `k6-${vus}-order-${index}-${Date.now()}` }, tags: { endpoint: 'setup_order' } },
    });
  }
  const orderResponses = batchChunks(orderRequests);
  const orders = orderResponses.map(jsonData).filter(Boolean);
  if (orders.length !== lifecycleCount) throw new Error(`Setup created ${orders.length}/${lifecycleCount} orders`);

  const trackingResponses = batchChunks(orders.map((order, index) => ({
    method: 'GET', url: `${baseUrl}/api/orders/${order.orderId}/tracking-link`,
    params: { headers: headers(), tags: { endpoint: `setup_tracking_link_${index}` } },
  })));
  const trackingTokens = trackingResponses
    .map((response) => jsonData(response)?.url?.split('/track/')[1])
    .filter(Boolean);
  if (trackingTokens.length !== orders.length) {
    throw new Error(`Tracking setup created ${trackingTokens.length}/${orders.length} tokens`);
  }

  return { drivers, orders, trackingTokens };
}

let lifecycleDone = false;

const record = (response, trend, expected = 200) => {
  flowRequests.add(1);
  trend.add(response.timings.duration);
  const ok = check(response, { [`HTTP ${expected}`]: (result) => result.status === expected });
  errors.add(!ok);
};

export default function (data) {
  const flow = (__VU - 1) % 5;
  if (flow === 0) {
    const response = http.get(`${baseUrl}/api/orders?limit=50`, { headers: headers(), tags: { endpoint: 'get_orders' } });
    record(response, getOrdersDuration);
  } else if (flow === 1) {
    const token = data.trackingTokens[(__VU - 1) % data.trackingTokens.length];
    const response = http.get(`${baseUrl}/api/tracking/${encodeURIComponent(token)}`, { headers: headers(), tags: { endpoint: 'tracking_refresh' } });
    record(response, trackingDuration);
  } else if (flow === 2) {
    const driver = data.drivers[(__VU - 1) % data.drivers.length];
    const response = http.patch(`${baseUrl}/api/drivers/${driver.driverId}/location`, JSON.stringify({
      lat: 10.7769 + ((__ITER % 100) * 0.000001),
      lng: 106.7009 + ((__ITER % 100) * 0.000001),
      accuracy: 8,
      recordedAt: new Date().toISOString(),
    }), { headers: headers(true, 'gps'), tags: { endpoint: 'gps_update' } });
    record(response, gpsDuration);
  } else if (flow === 3) {
    const response = http.get(`${baseUrl}/api/operations/issues?limit=50`, { headers: headers(), tags: { endpoint: 'operations_issues' } });
    record(response, issuesDuration);
  } else if (!lifecycleDone) {
    const slot = Math.floor((__VU - 1) / 5) % data.orders.length;
    const order = data.orders[slot];
    const driver = data.drivers[(__VU - 1) % data.drivers.length];
    const startedAt = Date.now();
    const assignment = http.patch(`${baseUrl}/api/orders/${order.orderId}/assign`, JSON.stringify({ driverId: driver.driverId }), {
      headers: headers(true, 'assign'), tags: { endpoint: 'assign_mutation' },
    });
    let ok = assignment.status === 200;
    if (ok) {
      const status = http.patch(`${baseUrl}/api/orders/${order.orderId}/status`, JSON.stringify({ status: 'IN_PROGRESS' }), {
        headers: headers(true, 'status'), tags: { endpoint: 'status_mutation' },
      });
      ok = status.status === 200;
    }
    mutationDuration.add(Date.now() - startedAt);
    flowRequests.add(1);
    errors.add(!ok);
    check(ok, { 'assign and status mutation succeeded': (value) => value });
    lifecycleDone = true;
  } else {
    const response = http.get(`${baseUrl}/api/orders?limit=50`, { headers: headers(), tags: { endpoint: 'get_orders_after_mutation' } });
    record(response, getOrdersDuration);
  }
  sleep(0.5);
}

const metricValue = (data, name, value) => data.metrics[name]?.values?.[value] ?? null;

export function handleSummary(data) {
  const output = {
    profile: { vus, duration, baseUrl },
    generatedAt: new Date().toISOString(),
    metrics: data.metrics,
    summary: {
      throughputRps: metricValue(data, 'cloudfleet_flow_requests', 'rate'),
      errorRate: metricValue(data, 'cloudfleet_flow_errors', 'rate'),
      httpP95Ms: metricValue(data, 'http_req_duration', 'p(95)'),
    },
  };
  return {
    [`load/reports/k6-${vus}.json`]: JSON.stringify(output, null, 2),
    stdout: `CloudFleet ${vus} VUs: ${JSON.stringify(output.summary)}\n`,
  };
}
