import { createLocalBootstrapContext, loadLocalBootstrapConfig } from './local-bootstrap/config.js';
import { seedLocalFixturesV1 } from './local-bootstrap/fixtures/v1.js';
import { runLocalMigrations } from './local-bootstrap/migrations.js';
import { setupLocalResources } from './local-bootstrap/resource-setup.js';

export const runLocalBootstrap = async (): Promise<void> => {
  const context = createLocalBootstrapContext(loadLocalBootstrapConfig());
  try {
    await setupLocalResources(context);
    await runLocalMigrations(context);
    await seedLocalFixturesV1(context);
  } finally {
    context.dynamoClient.destroy();
    context.storageClient.destroy();
  }
};

runLocalBootstrap().catch((error: unknown) => {
  console.error('Local infrastructure bootstrap failed', error);
  process.exitCode = 1;
});
