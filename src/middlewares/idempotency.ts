import type { RequestHandler, Response } from 'express';

import { AppError } from '../errors/app-error.js';
import type { IdempotencyService } from '../services/idempotency.service.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const enforceIdempotency = (
  service: IdempotencyService,
): RequestHandler => async (request, response, next) => {
  if (!MUTATING_METHODS.has(request.method)) {
    next();
    return;
  }

  const key = request.header('idempotency-key')?.trim();
  if (!key || !KEY_PATTERN.test(key)) {
    next(new AppError(
      400,
      'Idempotency-Key must contain 8-128 letters, numbers, dots, colons, underscores or hyphens',
      'IDEMPOTENCY_KEY_REQUIRED',
    ));
    return;
  }

  try {
    const started = await service.begin({
      key,
      identity: request.authenticatedUser?.subject ?? request.params.trackingToken ?? 'anonymous',
      method: request.method,
      path: request.originalUrl,
      body: request.body ?? null,
    });

    if (started.kind === 'REPLAY') {
      response.setHeader('Idempotency-Replayed', 'true');
      response.status(started.statusCode).json(started.body);
      return;
    }

    const originalJson = response.json.bind(response);
    response.json = ((body: unknown) => {
      response.json = originalJson;
      if (response.statusCode >= 200 && response.statusCode < 300) {
        void service
          .complete(started.recordKey, started.fingerprint, response.statusCode, body)
          .then(() => originalJson(body))
          .catch((error: unknown) => next(error));
      } else {
        void service
          .abandon(started.recordKey, started.fingerprint)
          .catch(() => undefined)
          .finally(() => originalJson(body));
      }
      return response;
    }) as Response['json'];

    next();
  } catch (error: unknown) {
    next(error);
  }
};
