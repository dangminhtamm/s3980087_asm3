#!/usr/bin/env node
import { App } from 'aws-cdk-lib';

import { CloudFleetStack } from '../lib/cloudfleet-stack.js';

const app = new App();
const projectName = app.node.tryGetContext('projectName') as string | undefined;
const stage = app.node.tryGetContext('stage') as string | undefined;

new CloudFleetStack(app, 'CloudFleetStack', {
  projectName: projectName?.trim() || 'cloudfleet',
  stage: stage?.trim() || 'dev',
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-southeast-1',
  },
  description: 'CloudFleet logistics platform infrastructure',
});
