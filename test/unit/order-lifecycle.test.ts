import assert from 'node:assert/strict';
import test from 'node:test';

import {
  allowedOrderTransitions,
  canTransitionOrder,
  isExceptionStatus,
  releasesDriver,
} from '../../src/domain/order-lifecycle.js';

test('happy-path delivery requires assignment and arrival', () => {
  assert.equal(canTransitionOrder('PENDING', 'ASSIGNED'), true);
  assert.equal(canTransitionOrder('ASSIGNED', 'IN_PROGRESS'), true);
  assert.equal(canTransitionOrder('IN_PROGRESS', 'ARRIVED'), true);
  assert.equal(canTransitionOrder('ARRIVED', 'DELIVERED'), true);
  assert.equal(canTransitionOrder('PENDING', 'DELIVERED'), false);
  assert.equal(canTransitionOrder('IN_PROGRESS', 'DELIVERED'), false);
});

test('exception workflow supports reschedule and return paths', () => {
  assert.deepEqual(allowedOrderTransitions('DELIVERY_FAILED'), ['RESCHEDULED', 'RETURNING']);
  assert.equal(canTransitionOrder('RESCHEDULED', 'ASSIGNED'), true);
  assert.equal(canTransitionOrder('RETURNING', 'RETURNED'), true);
  assert.equal(isExceptionStatus('DELIVERY_FAILED'), true);
  assert.equal(isExceptionStatus('CANCELLED'), true);
});

test('terminal states cannot transition and release rules are explicit', () => {
  for (const status of ['DELIVERED', 'CANCELLED', 'RETURNED'] as const) {
    assert.deepEqual(allowedOrderTransitions(status), []);
  }
  assert.equal(releasesDriver('DELIVERED'), true);
  assert.equal(releasesDriver('RESCHEDULED'), true);
  assert.equal(releasesDriver('RETURNED'), true);
  assert.equal(releasesDriver('DELIVERY_FAILED'), false);
});
