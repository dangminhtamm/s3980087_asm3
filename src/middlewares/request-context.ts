import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';
import { durationMsSince, emitMetrics } from '../observability/metrics.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

const safePath = (path: string): string =>
  path
    .replace(/\/api\/tracking\/[^/]+/, '/api/tracking/:trackingToken')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/(DRV|ROUTE)-[A-Za-z0-9_-]+/g, '/:id');

export const requestContext: RequestHandler = (request, response, next) => {
  const suppliedRequestId = request.header('x-request-id')?.trim();
  const requestId =
    suppliedRequestId && REQUEST_ID_PATTERN.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();
  const startedAt = process.hrtime.bigint();
  const path = safePath(request.path);

  request.requestId = requestId;
  response.setHeader('X-Request-ID', requestId);

  response.once('finish', () => {
    const durationMs = durationMsSince(startedAt);
    const statusClass = `${Math.floor(response.statusCode / 100)}xx`;
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'http_request',
        requestId,
        method: request.method,
        path,
        statusCode: response.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
    emitMetrics(
      [
        { name: 'HttpRequestDuration', value: durationMs, unit: 'Milliseconds' },
        { name: 'HttpRequestCount', value: 1, unit: 'Count' },
        { name: 'HttpErrorRate', value: response.statusCode >= 400 ? 100 : 0, unit: 'Percent' },
        ...(response.statusCode >= 400
          ? [{ name: 'HttpErrorCount', value: 1, unit: 'Count' as const }]
          : []),
      ],
      {
        Method: request.method,
        Route: path,
      },
      { requestId, statusClass },
    );
  });

  next();
};
