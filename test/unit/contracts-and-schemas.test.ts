import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ALLOWED_PROOF_CONTENT_TYPES,
  DRIVER_STATUSES,
  ORDER_EVENT_TYPES,
  ORDER_EXCEPTION_REASONS,
  ORDER_STATUSES,
} from '../../packages/contracts/index.js';

const readSchema = async (name: string): Promise<Record<string, unknown>> =>
  JSON.parse(
    await readFile(
      new URL(`../../src/infrastructure/database/schemas/${name}`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;

const enumAt = (schema: Record<string, unknown>, property: string): unknown[] => {
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  return properties[property]?.enum as unknown[];
};

test('DynamoDB documentation schemas use the canonical contract enums', async () => {
  const [orders, drivers, events, proof] = await Promise.all([
    readSchema('orders-table.schema.json'),
    readSchema('driver-item.schema.json'),
    readSchema('order-events.schema.json'),
    readSchema('delivery-proof-item.schema.json'),
  ]);

  assert.deepEqual(enumAt(orders, 'status'), [...ORDER_STATUSES]);
  const orderProperties = orders.properties as Record<string, Record<string, unknown>>;
  const exceptionProperties = orderProperties.exception?.properties as Record<
    string,
    Record<string, unknown>
  >;
  assert.deepEqual(exceptionProperties.reason?.enum, [...ORDER_EXCEPTION_REASONS]);
  assert.deepEqual(enumAt(drivers, 'status'), [...DRIVER_STATUSES]);
  assert.deepEqual(enumAt(events, 'type'), [...ORDER_EVENT_TYPES]);
  assert.deepEqual(enumAt(proof, 'contentType'), [...ALLOWED_PROOF_CONTENT_TYPES]);
});

test('every DynamoDB documentation schema is parseable JSON Schema 2020-12', async () => {
  const names = [
    'delivery-proof-item.schema.json',
    'driver-item.schema.json',
    'driver-location-item.schema.json',
    'order-events.schema.json',
    'orders-table.schema.json',
  ];

  for (const name of names) {
    const schema = await readSchema(name);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(typeof schema.title, 'string');
    assert.equal(schema.type, 'object');
  }
});
