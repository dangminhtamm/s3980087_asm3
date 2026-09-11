import assert from 'node:assert/strict';
import test from 'node:test';

import { Router } from 'express';

import { createApp } from '../../src/app.js';
import { asyncHandler } from '../../src/http/async-handler.js';

test('server module can be imported without starting a listener', async () => {
  const serverModule = await import('../../src/server.js');
  assert.equal(typeof serverModule.startServer, 'function');
});

const listen = async () => {
  const apiRouter = Router();
  apiRouter.post('/echo', (request, response) => {
    response.status(201).json({ data: request.body });
  });
  apiRouter.get(
    '/failure',
    asyncHandler(async () => {
      throw new Error('factory failure');
    }),
  );
  const healthRouter = Router();
  healthRouter.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'test-api' });
  });

  const app = createApp({
    config: {
      runtime: {
        nodeEnv: 'test',
        port: 3000,
        corsAllowedOrigins: ['https://allowed.example.com'],
      },
    },
    apiRouter,
    healthRouter,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};

test('app factory wires health, API parsing, errors and request IDs without owning a port', async () => {
  const running = await listen();
  try {
    const health = await fetch(`${running.baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get('x-request-id') ?? '', /^[A-Za-z0-9-]{8,}$/);

    const echo = await fetch(`${running.baseUrl}/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    assert.equal(echo.status, 201);
    assert.deepEqual(await echo.json(), { data: { message: 'hello' } });

    const failure = await fetch(`${running.baseUrl}/api/failure`);
    assert.equal(failure.status, 500);
    assert.equal(
      ((await failure.json()) as { error: { code: string } }).error.code,
      'INTERNAL_SERVER_ERROR',
    );

    const missing = await fetch(`${running.baseUrl}/missing`);
    assert.equal(missing.status, 404);
    assert.equal(
      ((await missing.json()) as { error: { code: string } }).error.code,
      'ROUTE_NOT_FOUND',
    );
  } finally {
    await running.close();
  }
});

test('app factory preserves the CORS allowlist contract', async () => {
  const running = await listen();
  try {
    const allowed = await fetch(`${running.baseUrl}/health`, {
      headers: { Origin: 'https://allowed.example.com' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example.com');

    const denied = await fetch(`${running.baseUrl}/health`, {
      headers: { Origin: 'https://denied.example.com' },
    });
    assert.equal(denied.status, 403);
    assert.equal(((await denied.json()) as { error: { code: string } }).error.code, 'CORS_DENIED');
  } finally {
    await running.close();
  }
});
