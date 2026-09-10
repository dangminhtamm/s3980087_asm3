import 'dotenv/config';

import cors, { type CorsOptions } from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { HeadBucketCommand } from '@aws-sdk/client-s3';

import { dynamoDBClient, ORDERS_TABLE_NAME } from './config/db.js';
import {
  DELIVERY_PROOF_BUCKET,
  s3Client,
  s3PresignClient,
} from './config/s3.js';
import { webSocketManagementClient } from './config/realtime.js';
import { AppError } from './errors/app-error.js';
import {
  globalErrorHandler,
  notFoundHandler,
} from './middlewares/error-handler.js';
import { apiRouter } from './routes/api.routes.js';
import { requestContext } from './middlewares/request-context.js';

const parsePort = (rawPort: string | undefined): number => {
  const port = Number(rawPort ?? '3000');

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
};

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error('CORS_ALLOWED_ORIGINS is required in production');
}

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Requests without Origin are typically server-to-server or health checks.
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
};

export const app = express();

// API Gateway/load balancers terminate TLS before forwarding traffic to ECS.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(requestContext);
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.text({ type: ['text/csv', 'application/csv'], limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const healthCheck: RequestHandler = (_request, response) => {
  response.status(200).json({ status: 'ok', service: 'cloudfleet-api' });
};

app.get('/health', healthCheck);
app.get('/ready', async (_request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const [dynamodb, s3] = await Promise.allSettled([
    dynamoDBClient.send(new DescribeTableCommand({ TableName: ORDERS_TABLE_NAME })),
    s3Client.send(new HeadBucketCommand({ Bucket: DELIVERY_PROOF_BUCKET })),
  ]);
  const dependencies = {
    dynamodb: dynamodb.status === 'fulfilled' ? 'ready' : 'unavailable',
    s3: s3.status === 'fulfilled' ? 'ready' : 'unavailable',
  };
  if (dynamodb.status === 'fulfilled' && s3.status === 'fulfilled') {
    response.status(200).json({
      status: 'ready',
      service: 'cloudfleet-api',
      dependencies,
    });
  } else {
    console.error(JSON.stringify({
      level: 'error',
      event: 'readiness_failed',
      dependencies,
    }));
    response.status(503).json({
      status: 'not_ready',
      service: 'cloudfleet-api',
      dependencies,
    });
  }
});
app.use('/api', apiRouter);
app.use(notFoundHandler);
app.use(globalErrorHandler);

const port = parsePort(process.env.PORT);
const server = app.listen(port, () => {
  console.info(`CloudFleet API is listening on port ${port}`);
});

const shutdown = (signal: NodeJS.Signals): void => {
  console.info(`${signal} received; shutting down gracefully`);

  server.close((error) => {
    dynamoDBClient.destroy();
    s3Client.destroy();
    if (s3PresignClient !== s3Client) s3PresignClient.destroy();
    webSocketManagementClient?.destroy();

    if (error) {
      console.error('Failed to close HTTP server', error);
      process.exitCode = 1;
    }
  });
};

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
