import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../../src/config/app-config.js';

const requiredEnvironment = (): NodeJS.ProcessEnv => ({
  AWS_REGION: 'ap-southeast-1',
  DYNAMODB_TABLE_NAME: 'orders-test',
  S3_DELIVERY_PROOF_BUCKET: 'proofs-test',
});

test('typed configuration applies defaults and parses environment values once', () => {
  const config = loadConfig({
    ...requiredEnvironment(),
    PORT: '4321',
    CORS_ALLOWED_ORIGINS: ' https://admin.example.com, https://driver.example.com ',
    S3_FORCE_PATH_STYLE: 'true',
    ROUTING_ORIGIN_LAT: '10.8',
    ROUTING_ORIGIN_LNG: '106.7',
  });

  assert.equal(config.runtime.port, 4321);
  assert.deepEqual(config.runtime.corsAllowedOrigins, [
    'https://admin.example.com',
    'https://driver.example.com',
  ]);
  assert.equal(config.auth.mode, 'disabled');
  assert.equal(config.s3.forcePathStyle, true);
  assert.deepEqual(config.routing.origin, { lat: 10.8, lng: 106.7 });
  assert.equal(config.geocoding.minIntervalMs, 1000);
});

test('configuration fails fast for missing resources and invalid ports', () => {
  assert.throws(
    () => loadConfig({ AWS_REGION: 'ap-southeast-1', S3_DELIVERY_PROOF_BUCKET: 'proofs' }),
    /DYNAMODB_TABLE_NAME/,
  );
  assert.throws(() => loadConfig({ ...requiredEnvironment(), PORT: '70000' }), /Too big/);
});

test('production CORS and Cognito dependencies are validated together', () => {
  assert.throws(
    () => loadConfig({ ...requiredEnvironment(), NODE_ENV: 'production' }),
    /CORS_ALLOWED_ORIGINS is required in production/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...requiredEnvironment(),
        AUTH_MODE: 'cognito',
      }),
    /COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required/,
  );
});
