import type { Server } from 'node:http';

import { createApp } from './app.js';
import type { AppConfig } from './config/app-config.js';
import { loadConfig } from './config/app-config.js';
import { createContainer } from './composition-root.js';
import { createHealthRouter } from './health/health.routes.js';
import { createApiRouter } from './routes/api.routes.js';

export interface RunningServer {
  server: Server;
  shutdown(signal?: NodeJS.Signals): void;
}

/** Explicit process boundary. Importing this module never opens an HTTP port. */
export const startServer = (config: AppConfig = loadConfig()): RunningServer => {
  const container = createContainer(config);
  const app = createApp({
    config,
    apiRouter: createApiRouter(container.api),
    healthRouter: createHealthRouter({
      databaseClient: container.clients.databaseClient,
      objectStorageClient: container.clients.objectStorageClient,
      tableName: config.dynamodb.tableName,
      deliveryProofBucket: config.s3.deliveryProofBucket,
    }),
  });
  const server = app.listen(config.runtime.port, () => {
    console.info(`CloudFleet API is listening on port ${config.runtime.port}`);
  });

  let closing = false;
  const shutdown = (signal?: NodeJS.Signals): void => {
    if (closing) return;
    closing = true;
    if (signal) console.info(`${signal} received; shutting down gracefully`);
    server.close((error) => {
      container.close();
      if (error) {
        console.error('Failed to close HTTP server', error);
        process.exitCode = 1;
      }
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return { server, shutdown };
};
