#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { CliCredentialsStackSynthesizer } from 'aws-cdk-lib';
import { CloudFleetStack } from '../lib/cloudfleet-stack.js';
import { deploymentConfigFromApp } from '../lib/deployment-config.js';

const app = new App();
const deployment = deploymentConfigFromApp(app);

new CloudFleetStack(app, 'CloudFleetStack', {
  deployment,
  env: {
    account: '709905532063',
    region: 'us-east-1',
  },
  description: 'CloudFleet logistics platform infrastructure',
  synthesizer: new CliCredentialsStackSynthesizer(),
});
