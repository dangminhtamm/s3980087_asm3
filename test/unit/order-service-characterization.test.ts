import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { OrderService } from '../../src/services/order.service.js';
import { driverFixture, orderFixture } from '../helpers/fixtures.js';

test('status update atomically records the order, route stop and event', async () => {
  const current = orderFixture({
    status: 'IN_PROGRESS',
    driverId: 'DRV-001',
    routeId: '00000000-0000-4000-8000-000000000010',
    stopSequence: 2,
    startedAt: '2026-09-10T00:10:00.000Z',
  });
  let updated = false;
  let transaction: TransactWriteCommand | null = null;
  const database = {
    send: async (command: unknown) => {
      if (command instanceof GetCommand) {
        const key = command.input.Key;
        if (key?.SK === 'TRACKING#TOKEN') {
          return { Item: { trackingToken: 'token', expiresAt: 4_102_444_800 } };
        }
        return {
          Item: updated
            ? { ...current, status: 'ARRIVED', arrivedAt: new Date().toISOString() }
            : current,
        };
      }
      if (command instanceof TransactWriteCommand) {
        transaction = command;
        updated = true;
        return {};
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    },
  } as unknown as DynamoDBDocumentClient;

  const result = await new OrderService(database, 'table', 'https://tracking.test').updateStatus(
    current.orderId,
    { status: 'ARRIVED' },
    'DRV-001',
  );

  assert.equal(result.status, 'ARRIVED');
  assert.ok(transaction);
  const items = transaction.input.TransactItems ?? [];
  assert.equal(items.length, 3);
  assert.equal(items[0]?.Update?.ExpressionAttributeValues?.[':expectedStatus'], 'IN_PROGRESS');
  assert.equal(items[1]?.Put?.Item?.type, 'DRIVER_ARRIVED');
  assert.equal(items[2]?.Update?.Key?.SK, `STOP#002#ORDER#${current.orderId}`);
  assert.match(items[2]?.Update?.UpdateExpression ?? '', /actualArrivalAt/);
});

test('assignment atomically updates the order, driver and audit event', async () => {
  const pending = orderFixture();
  const driver = driverFixture();
  let assigned = false;
  let transaction: TransactWriteCommand | null = null;
  const database = {
    send: async (command: unknown) => {
      if (command instanceof GetCommand) {
        if (command.input.Key?.PK === `DRIVER#${driver.driverId}`) return { Item: driver };
        return {
          Item: assigned ? { ...pending, status: 'ASSIGNED', driverId: driver.driverId } : pending,
        };
      }
      if (command instanceof QueryCommand) return { Items: [] };
      if (command instanceof TransactWriteCommand) {
        transaction = command;
        assigned = true;
        return {};
      }
      throw new Error(`Unexpected command: ${String(command)}`);
    },
  } as unknown as DynamoDBDocumentClient;

  const result = await new OrderService(database, 'table').assignDriver(
    pending.orderId,
    driver.driverId,
    'admin-1',
  );

  assert.equal(result.driverId, driver.driverId);
  assert.equal(result.status, 'ASSIGNED');
  assert.ok(transaction);
  const items = transaction.input.TransactItems ?? [];
  assert.equal(items.length, 3);
  assert.equal(items[0]?.Update?.ExpressionAttributeValues?.[':assigned'], 'ASSIGNED');
  assert.equal(items[1]?.Update?.Key?.PK, `DRIVER#${driver.driverId}`);
  assert.equal(items[2]?.Put?.Item?.type, 'DRIVER_ASSIGNED');
});

test('creation stores order, audit event and both tracking-token records in one transaction', async () => {
  let transaction: TransactWriteCommand | null = null;
  const database = {
    send: async (command: unknown) => {
      if (!(command instanceof TransactWriteCommand)) throw new Error('Unexpected command');
      transaction = command;
      return {};
    },
  } as unknown as DynamoDBDocumentClient;

  const order = await new OrderService(database, 'table').createOrder(
    {
      customerName: 'Customer',
      customerPhone: '+84901234567',
      dropoffAddress: '1 Main Street',
      region: 'District 1',
      lat: 10.77,
      lng: 106.7,
    },
    'admin-1',
  );

  assert.equal(order.status, 'PENDING');
  assert.equal(order.driverId, null);
  assert.ok(transaction);
  const items = transaction.input.TransactItems ?? [];
  assert.equal(items.length, 4);
  assert.equal(items[0]?.Put?.Item?.orderId, order.orderId);
  assert.equal(items[1]?.Put?.Item?.type, 'ORDER_CREATED');
  assert.equal(items[2]?.Put?.Item?.SK, 'TRACKING#TOKEN');
  assert.equal(items[3]?.Put?.Item?.SK, 'TOKEN');
  assert.equal('trackingToken' in order, false);
});

test('order queries preserve status and driver access patterns', async () => {
  const stored = orderFixture();
  const commands: QueryCommand[] = [];
  const database = {
    send: async (command: unknown) => {
      if (!(command instanceof QueryCommand)) throw new Error('Unexpected command');
      commands.push(command);
      return { Items: [stored] };
    },
  } as unknown as DynamoDBDocumentClient;
  const service = new OrderService(database, 'table');

  assert.deepEqual(await service.listOrders({ status: 'PENDING', limit: 10 }), [stored]);
  assert.deepEqual(await service.listOrders({ driverId: 'DRV-001', limit: 10 }), [stored]);
  assert.equal(commands[0]?.input.IndexName, 'GSI2');
  assert.equal(commands[1]?.input.IndexName, 'GSI1');
});

test('tracking link reads the existing capability without exposing it on the order', async () => {
  const stored = orderFixture();
  const database = {
    send: async (command: unknown) => {
      if (!(command instanceof GetCommand)) throw new Error('Unexpected command');
      if (command.input.Key?.SK === 'TRACKING#TOKEN') {
        return { Item: { trackingToken: 'existing-token', expiresAt: 4_102_444_800 } };
      }
      return { Item: stored };
    },
  } as unknown as DynamoDBDocumentClient;

  const link = await new OrderService(database, 'table', 'https://tracking.test/').getTrackingLink(
    stored.orderId,
  );
  assert.equal(link.url, 'https://tracking.test/track/existing-token');
  assert.equal(link.expiresAt, '2100-01-01T00:00:00.000Z');
});
