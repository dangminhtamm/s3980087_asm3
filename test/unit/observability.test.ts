import assert from 'node:assert/strict';
import test from 'node:test';

import { emitMetrics } from '../../src/observability/metrics.js';
import { frontendTelemetrySchema } from '../../src/schemas/telemetry.schema.js';

test('EMF writer emits finite metrics with bounded dimensions', () => {
  let line = '';
  const original = console.info;
  console.info = (value?: unknown) => { line = String(value); };
  try {
    emitMetrics([
      { name: 'ExampleDuration', value: 12.5, unit: 'Milliseconds' },
      { name: 'Ignored', value: Number.NaN, unit: 'Count' },
    ], { Route: '/api/orders\nforged' }, { requestId: 'request-1' });
  } finally {
    console.info = original;
  }
  const payload = JSON.parse(line) as Record<string, unknown>;
  assert.equal(payload.ExampleDuration, 12.5);
  assert.equal(payload.Ignored, undefined);
  assert.equal(payload.Route, '/api/orders forged');
  assert.equal(payload.requestId, 'request-1');
  assert.ok(payload._aws);
});

test('frontend telemetry accepts fixed low-cardinality events and rejects identifiers', () => {
  assert.equal(frontendTelemetrySchema.safeParse({
    type: 'WEB_VITAL', name: 'LCP', value: 1200, delta: 30,
    rating: 'good', page: 'tracking', deviceType: 'mobile',
    navigationType: 'navigate',
  }).success, true);
  assert.equal(frontendTelemetrySchema.safeParse({
    type: 'WEB_VITAL', name: 'LCP', value: 1200, delta: 30,
    rating: 'good', page: '/track/customer-token', deviceType: 'mobile',
    navigationType: 'navigate', orderId: 'secret',
  }).success, false);
});
