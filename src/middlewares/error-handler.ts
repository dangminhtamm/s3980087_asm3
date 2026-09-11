import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { AppError } from '../errors/app-error.js';

const AWS_CONFIGURATION_ERRORS = new Set([
  'AccessDeniedException',
  'CredentialsProviderError',
  'InvalidSignatureException',
  'ResourceNotFoundException',
  'UnrecognizedClientException',
]);

const AWS_TRANSIENT_ERRORS = new Set([
  'InternalServerError',
  'ProvisionedThroughputExceededException',
  'ServiceUnavailable',
  'ThrottlingException',
]);

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(
    new AppError(
      404,
      `Route ${request.method} ${request.originalUrl} not found`,
      'ROUTE_NOT_FOUND',
    ),
  );
};

/** Converts trusted application and validation errors to consistent JSON. */
export const globalErrorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  _next,
) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId: request.requestId,
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
        requestId: request.requestId,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
        requestId: request.requestId,
      },
    });
    return;
  }

  const errorName = error instanceof Error ? error.name : 'Unknown infrastructure error';

  if (AWS_CONFIGURATION_ERRORS.has(errorName)) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'aws_configuration_error',
        requestId: request.requestId,
        error: errorName,
      }),
    );
    response.status(503).json({
      error: {
        code: 'AWS_CONFIGURATION_ERROR',
        message: 'A required AWS resource or credential is not configured',
        requestId: request.requestId,
      },
    });
    return;
  }

  if (AWS_TRANSIENT_ERRORS.has(errorName)) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'aws_service_unavailable',
        requestId: request.requestId,
        error: errorName,
      }),
    );
    response.status(503).json({
      error: {
        code: 'AWS_SERVICE_UNAVAILABLE',
        message: 'An AWS dependency is temporarily unavailable',
        requestId: request.requestId,
      },
    });
    return;
  }

  console.error(
    JSON.stringify({
      level: 'error',
      event: 'unhandled_request_error',
      requestId: request.requestId,
      error: errorName,
      message: error instanceof Error ? error.message : 'Unknown infrastructure error',
      ...(process.env.NODE_ENV === 'development' && error instanceof Error
        ? { stack: error.stack }
        : {}),
    }),
  );
  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      requestId: request.requestId,
    },
  });
};
