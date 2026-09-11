import assert from 'node:assert/strict';
import test from 'node:test';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

import {
  loadLocalBootstrapConfig,
  type LocalBootstrapContext,
} from '../../src/scripts/local-bootstrap/config.js';
import {
  LOCAL_FIXTURE_VERSION,
  seedLocalFixturesV1,
} from '../../src/scripts/local-bootstrap/fixtures/v1.js';
import { LOCAL_MIGRATIONS } from '../../src/scripts/local-bootstrap/migrations.js';

test('local bootstrap config fails fast and maps one typed environment object', () => {
  const config = loadLocalBootstrapConfig({
    AWS_REGION: 'ap-southeast-1',
    DYNAMODB_TABLE_NAME: 'orders',
    S3_DELIVERY_PROOF_BUCKET: 'proof',
    S3_ANALYTICS_BUCKET: 'analytics',
    DYNAMODB_ENDPOINT: 'http://dynamodb:8000',
    S3_ENDPOINT: 'http://minio:9000',
  });
  assert.equal(config.tableName, 'orders');
  assert.equal(config.analyticsBucket, 'analytics');
  assert.throws(() => loadLocalBootstrapConfig({}), /AWS_REGION/);
});

test('local migration and fixture versions are explicit and unique', () => {
  assert.match(LOCAL_FIXTURE_VERSION, /^\d{4}-\d{2}-\d{2}-v\d+$/);
  assert.deepEqual(
    new Set(LOCAL_MIGRATIONS.map(({ version }) => version)).size,
    LOCAL_MIGRATIONS.length,
  );
});

test('versioned local fixtures can be applied twice without duplicate DynamoDB writes', async () => {
  const keys = new Set<string>();
  const documentClient = {
    send: (command: unknown) => {
      if (command instanceof PutCommand) {
        const item = command.input.Item!;
        const key = `${String(item.PK)}|${String(item.SK)}`;
        if (keys.has(key)) {
          const error = new Error('already seeded');
          error.name = 'ConditionalCheckFailedException';
          return Promise.reject(error);
        }
        keys.add(key);
      }
      return Promise.resolve({});
    },
  };
  const storageClient = { send: () => Promise.resolve({}) };
  const context = {
    region: 'ap-southeast-1',
    tableName: 'orders',
    proofBucket: 'proof',
    analyticsBucket: 'analytics',
    dynamoEndpoint: 'http://dynamodb',
    s3Endpoint: 'http://s3',
    documentClient,
    storageClient,
    dynamoClient: { destroy: () => undefined },
  } as unknown as LocalBootstrapContext;

  await seedLocalFixturesV1(context);
  const firstCount = keys.size;
  await seedLocalFixturesV1(context);

  assert.ok(firstCount > 0);
  assert.equal(keys.size, firstCount);
  assert.ok(keys.has(`LOCAL_FIXTURE|${LOCAL_FIXTURE_VERSION}`));
});
