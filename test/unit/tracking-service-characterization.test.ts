import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GetCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type { DriverService } from '../../src/services/driver.service.js';
import type { OrderEventService } from '../../src/services/order-event.service.js';
import type { OrderService } from '../../src/services/order.service.js';
import { TrackingService } from '../../src/services/tracking.service.js';
import { driverFixture, orderFixture } from '../helpers/fixtures.js';

test('public tracking combines safe order, event, driver and proof fields', async () => {
  const order = orderFixture({
    status: 'IN_PROGRESS',
    driverId: 'DRV-001',
    plannedArrivalAt: '2026-09-10T01:00:00.000Z',
  });
  const driver = driverFixture({
    lat: 10.7705,
    lng: 106.7005,
    locationUpdatedAt: new Date().toISOString(),
  });
  const database = {
    send: async (command: unknown) => {
      if (!(command instanceof GetCommand)) throw new Error('Unexpected DynamoDB command');
      const key = command.input.Key;
      if (String(key?.PK).startsWith('TRACKING#')) {
        return { Item: { orderId: order.orderId, expiresAt: 4_102_444_800 } };
      }
      if (key?.SK === 'PROOF#POD') {
        return {
          Item: {
            uploadedAt: '2026-09-10T01:00:00.000Z',
            recipientName: 'Recipient',
            signatureDataUrl: 'data:image/png;base64,abc',
          },
        };
      }
      if (key?.SK === 'CUSTOMER#FEEDBACK') return {};
      throw new Error(`Unexpected key: ${JSON.stringify(key)}`);
    },
  } as unknown as DynamoDBDocumentClient;
  const orders = { getOrder: async () => order } as unknown as OrderService;
  const events = {
    list: async () => [
      {
        eventId: 'event-1',
        orderId: order.orderId,
        type: 'DELIVERY_STARTED' as const,
        occurredAt: '2026-09-10T00:10:00.000Z',
        actorId: 'DRV-001',
        source: 'RECORDED' as const,
        metadata: {},
      },
    ],
  } as unknown as OrderEventService;
  const drivers = { getDriver: async () => driver } as unknown as DriverService;

  const tracking = await new TrackingService(
    database,
    'table',
    orders,
    events,
    drivers,
  ).getTracking('customer-capability-token');

  assert.equal(tracking.status, 'IN_PROGRESS');
  assert.equal(tracking.driver?.name, driver.name);
  assert.equal(tracking.proof.confirmed, true);
  assert.equal(tracking.proof.signatureCaptured, true);
  assert.equal(tracking.timeline[0]?.type, 'DELIVERY_STARTED');
  assert.equal('customerPhone' in tracking, false);
  assert.equal('orderId' in tracking, false);
});

test('customer feedback and reschedule requests retain their atomic audit events', async () => {
  const delivered = orderFixture({ status: 'DELIVERED', deliveredAt: new Date().toISOString() });
  const transactions: TransactWriteCommand[] = [];
  const database = {
    send: async (command: unknown) => {
      if (command instanceof GetCommand) {
        return { Item: { orderId: delivered.orderId, expiresAt: 4_102_444_800 } };
      }
      if (command instanceof TransactWriteCommand) {
        transactions.push(command);
        return {};
      }
      throw new Error('Unexpected command');
    },
  } as unknown as DynamoDBDocumentClient;
  const orders = { getOrder: async () => delivered } as unknown as OrderService;
  const events = { list: async () => [] } as unknown as OrderEventService;
  const drivers = { getDriver: async () => driverFixture() } as unknown as DriverService;
  const service = new TrackingService(database, 'table', orders, events, drivers);

  const feedback = await service.submitFeedback('token', { rating: 5, comment: 'Great' });
  assert.equal(feedback.rating, 5);
  assert.equal(
    transactions[0]?.input.TransactItems?.[1]?.Put?.Item?.type,
    'CUSTOMER_FEEDBACK_RECEIVED',
  );

  const reschedule = await service.requestReschedule('token', {
    requestedWindowStart: '2026-09-12T01:00:00.000Z',
    requestedWindowEnd: '2026-09-12T03:00:00.000Z',
    notes: 'Call first',
  });
  assert.equal(reschedule.notes, 'Call first');
  assert.equal(
    transactions[1]?.input.TransactItems?.[1]?.Put?.Item?.type,
    'CUSTOMER_RESCHEDULE_REQUESTED',
  );
});
