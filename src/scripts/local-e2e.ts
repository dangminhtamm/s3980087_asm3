import { runDeliveryScenario } from './local-e2e/scenarios/delivery.scenario.js';

runDeliveryScenario()
  .then((orderId) => console.info(`\nCloudFleet local E2E passed for order ${orderId}`))
  .catch((error: unknown) => {
    console.error('\nCloudFleet local E2E failed', error);
    process.exitCode = 1;
  });
