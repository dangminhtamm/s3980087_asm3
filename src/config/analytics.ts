import { SFNClient } from '@aws-sdk/client-sfn';

import type { AppConfig } from './app-config.js';

/** Credentials are resolved from the ECS task role in AWS. */
export const createStepFunctionsClient = (config: AppConfig): SFNClient =>
  new SFNClient({ region: config.aws.region });
