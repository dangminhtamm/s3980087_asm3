import cors, { type CorsOptions } from 'cors';
import express, { type Router } from 'express';
import helmet from 'helmet';

import type { AppConfig } from './config/app-config.js';
import { AppError } from './errors/app-error.js';
import { createGlobalErrorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { requestContext } from './middlewares/request-context.js';

export interface AppDependencies {
  config: Pick<AppConfig, 'runtime'>;
  apiRouter: Router;
  healthRouter: Router;
}

const createCorsOptions = (allowedOrigins: string[]): CorsOptions => ({
  origin: (origin, callback) => {
    // Requests without Origin are server-to-server calls or health checks.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new AppError(403, 'Origin is not allowed by CORS', 'CORS_DENIED'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-ID'],
  exposedHeaders: ['Idempotency-Replayed', 'X-Request-ID'],
  credentials: true,
  maxAge: 600,
});

/** Pure application factory: creates middleware/routes without opening a port. */
export const createApp = ({ config, apiRouter, healthRouter }: AppDependencies) => {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(helmet());
  app.use(cors(createCorsOptions(config.runtime.corsAllowedOrigins)));
  app.use(express.text({ type: ['text/csv', 'application/csv'], limit: '2mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(healthRouter);
  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(createGlobalErrorHandler(config.runtime.nodeEnv));
  return app;
};
