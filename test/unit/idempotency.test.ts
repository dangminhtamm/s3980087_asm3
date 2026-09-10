import assert from 'node:assert/strict';
import test from 'node:test';

import { requestFingerprint } from '../../src/services/idempotency.service.js';

const baseRequest = {
  key: 'request-12345678',
  identity: 'user-1',
  method: 'POST',
  path: '/api/orders',
};

test('fingerprint is stable when JSON object keys are reordered', () => {
  const first = requestFingerprint({ ...baseRequest, body: { name: 'A', nested: { x: 1, y: 2 } } });
  const second = requestFingerprint({ ...baseRequest, body: { nested: { y: 2, x: 1 }, name: 'A' } });
  assert.equal(first, second);
});

test('fingerprint changes when request semantics change', () => {
  const original = requestFingerprint({ ...baseRequest, body: { name: 'A' } });
  assert.notEqual(original, requestFingerprint({ ...baseRequest, body: { name: 'B' } }));
  assert.notEqual(original, requestFingerprint({ ...baseRequest, method: 'PATCH', body: { name: 'A' } }));
  assert.notEqual(original, requestFingerprint({ ...baseRequest, path: '/api/drivers', body: { name: 'A' } }));
});
