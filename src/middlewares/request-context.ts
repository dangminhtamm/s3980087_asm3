import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

const safePath = (path: string): string =>
  path.replace(/\/api\/tracking\/[^/]+/, '/api/tracking/:token');

export const requestContext: RequestHandler = (request, response, next) => {
  const suppliedRequestId = request.header('x-request-id')?.trim();
  const requestId = suppliedRequestId && REQUEST_ID_PATTERN.test(suppliedRequestId)
    ? suppliedRequestId
    : randomUUID();
  const startedAt = process.hrtime.bigint();
  const path = safePath(request.path);

  request.requestId = requestId;
  response.setHeader('X-Request-ID', requestId);

  response.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.info(JSON.stringify({
      level: 'info',
      event: 'http_request',
      requestId,
      method: request.method,
      path,
      statusCode: response.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
    }));
  });

  next();
};
