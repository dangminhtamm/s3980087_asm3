#!/usr/bin/env node
import { App } from 'aws-cdk-lib';

import { CloudFleetStack } from '../lib/cloudfleet-stack.js';
import { deploymentConfigFromApp } from '../lib/deployment-config.js';

const app = new App();
const deployment = deploymentConfigFromApp(app);

new CloudFleetStack(app, 'CloudFleetStack', {
  deployment,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-southeast-1',
  },
  description: 'CloudFleet logistics platform infrastructure',
});
