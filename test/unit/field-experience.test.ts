import assert from 'node:assert/strict';
import test from 'node:test';

import { DeleteCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { registerDeliveryProofSchema } from '../../src/schemas/order.schema.js';
import {
  customerFeedbackSchema,
  customerRescheduleSchema,
} from '../../src/schemas/tracking.schema.js';
import { PushService } from '../../src/services/push.service.js';

test('enhanced proof accepts signature, barcode, notes and GPS with strict bounds', () => {
  const parsed = registerDeliveryProofSchema.parse({
    objectKey: 'proof-of-delivery/00000000-0000-4000-8000-000000000000/image.png',
    contentType: 'image/png',
    size: 128,
    recipientName: 'Mai Anh',
    signatureDataUrl: 'data:image/png;base64,aGVsbG8=',
    barcode: 'PKG-2026/001',
    notes: 'Handed to reception',
    gps: { lat: 10.77, lng: 106.7, accuracy: 7, recordedAt: new Date().toISOString() },
  });
  assert.equal(parsed.barcode, 'PKG-2026/001');
  assert.equal(
    registerDeliveryProofSchema.safeParse({ ...parsed, barcode: '<script>' }).success,
    false,
  );
});

test('customer actions validate rating and a future reschedule window', () => {
  assert.equal(
    customerFeedbackSchema.safeParse({ rating: 5, comment: 'Great delivery' }).success,
    true,
  );
  assert.equal(customerFeedbackSchema.safeParse({ rating: 0 }).success, false);
  const start = new Date(Date.now() + 60 * 60_000).toISOString();
  const end = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  assert.equal(
    customerRescheduleSchema.safeParse({ requestedWindowStart: start, requestedWindowEnd: end })
      .success,
    true,
  );
  assert.equal(
    customerRescheduleSchema.safeParse({ requestedWindowStart: end, requestedWindowEnd: start })
      .success,
    false,
  );
});

test('push service degrades safely when VAPID is not configured', async () => {
  const previousPublic = process.env.VAPID_PUBLIC_KEY;
  const previousPrivate = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  try {
    const service = new PushService({} as DynamoDBDocumentClient, 'test-table');
    assert.equal(service.getPublicKey(), null);
    assert.deepEqual(
      await service.notifyDriver('DRV-001', {
        title: 'Test',
        body: 'Test',
        url: '/driver',
        tag: 'test',
      }),
      { sent: 0, configured: false },
    );
  } finally {
    if (previousPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = previousPublic;
    if (previousPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = previousPrivate;
  }
});

test('push subscriptions use a stable endpoint identity for subscribe and unsubscribe', async () => {
  const commands: unknown[] = [];
  const database = {
    send: async (command: unknown) => {
      commands.push(command);
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  const service = new PushService(database, 'test-table');
  const input = {
    endpoint: 'https://push.test/subscription/1',
    keys: { p256dh: 'public-key', auth: 'auth-key' },
  };

  const subscription = await service.subscribe('DRV-001', input);
  await service.unsubscribe('DRV-001', input.endpoint);

  assert.ok(commands[0] instanceof PutCommand);
  assert.ok(commands[1] instanceof DeleteCommand);
  assert.equal(subscription.driverId, 'DRV-001');
  assert.equal(commands[0].input.Item?.SK, commands[1].input.Key?.SK);
});
