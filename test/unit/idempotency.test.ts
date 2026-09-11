import assert from 'node:assert/strict';
import test from 'node:test';

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { IdempotencyService, requestFingerprint } from '../../src/services/idempotency.service.js';

const baseRequest = {
  key: 'request-12345678',
  identity: 'user-1',
  method: 'POST',
  path: '/api/orders',
};

test('fingerprint is stable when JSON object keys are reordered', () => {
  const first = requestFingerprint({ ...baseRequest, body: { name: 'A', nested: { x: 1, y: 2 } } });
  const second = requestFingerprint({
    ...baseRequest,
    body: { nested: { y: 2, x: 1 }, name: 'A' },
  });
  assert.equal(first, second);
});

test('fingerprint changes when request semantics change', () => {
  const original = requestFingerprint({ ...baseRequest, body: { name: 'A' } });
  assert.notEqual(original, requestFingerprint({ ...baseRequest, body: { name: 'B' } }));
  assert.notEqual(
    original,
    requestFingerprint({ ...baseRequest, method: 'PATCH', body: { name: 'A' } }),
  );
  assert.notEqual(
    original,
    requestFingerprint({ ...baseRequest, path: '/api/drivers', body: { name: 'A' } }),
  );
});

test('new idempotency request reserves a durable in-progress record', async () => {
  let command: PutCommand | null = null;
  const database = {
    send: async (input: unknown) => {
      assert.ok(input instanceof PutCommand);
      command = input;
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  const result = await new IdempotencyService(database, 'table').begin({
    ...baseRequest,
    body: { name: 'A' },
  });

  assert.equal(result.kind, 'STARTED');
  assert.ok(command);
  assert.equal(command.input.Item?.status, 'IN_PROGRESS');
  assert.equal(command.input.ConditionExpression, 'attribute_not_exists(PK)');
});

test('completed idempotency request replays the stored HTTP response', async () => {
  const database = {
    send: async (command: unknown) => {
      if (command instanceof PutCommand) {
        throw new ConditionalCheckFailedException({ message: 'exists', $metadata: {} });
      }
      assert.ok(command instanceof GetCommand);
      return {
        Item: {
          fingerprint: requestFingerprint({ ...baseRequest, body: { name: 'A' } }),
          status: 'COMPLETED',
          responseStatus: 201,
          responseBody: { data: { id: 'order-1' } },
        },
      };
    },
  } as unknown as DynamoDBDocumentClient;

  const result = await new IdempotencyService(database, 'table').begin({
    ...baseRequest,
    body: { name: 'A' },
  });
  assert.deepEqual(result, {
    kind: 'REPLAY',
    statusCode: 201,
    body: { data: { id: 'order-1' } },
  });
});

test('completion and abandonment retain fingerprint ownership conditions', async () => {
  const commands: unknown[] = [];
  const database = {
    send: async (command: unknown) => {
      commands.push(command);
      return {};
    },
  } as unknown as DynamoDBDocumentClient;
  const service = new IdempotencyService(database, 'table');

  await service.complete('record', 'fingerprint', 200, { data: 'ok' });
  await service.abandon('record', 'fingerprint');

  assert.ok(commands[0] instanceof UpdateCommand);
  assert.equal(commands[0].input.ExpressionAttributeValues?.[':fingerprint'], 'fingerprint');
  assert.ok(commands[1] instanceof DeleteCommand);
  assert.equal(
    commands[1].input.ConditionExpression,
    'fingerprint = :fingerprint AND #status = :inProgress',
  );
});
