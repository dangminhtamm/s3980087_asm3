import 'dotenv/config';

import { startServer } from './server.js';

try {
  startServer();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : 'CloudFleet failed to start');
  process.exitCode = 1;
}
