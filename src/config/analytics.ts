import 'dotenv/config';

import { SFNClient } from '@aws-sdk/client-sfn';

const region = process.env.AWS_REGION?.trim();

if (!region) {
  throw new Error('Missing required environment variable: AWS_REGION');
}

/** Credentials are resolved from the ECS task role in AWS. */
export const stepFunctionsClient = new SFNClient({ region });

/** Empty in Docker Compose because EMR automation is an AWS-only workflow. */
export const ANALYTICS_STATE_MACHINE_ARN =
  process.env.ANALYTICS_STATE_MACHINE_ARN?.trim() || null;
