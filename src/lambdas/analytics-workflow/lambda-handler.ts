import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EMRServerlessClient } from '@aws-sdk/client-emr-serverless';
import { GlueClient } from '@aws-sdk/client-glue';
import { AnalyticsWorkflowService } from './analytics-workflow.service.js';
import { AwsDynamoExportAdapter } from './adapters/dynamodb-export.adapter.js';
import { AwsEmrAdapter } from './adapters/emr.adapter.js';
import { AwsGlueAdapter } from './adapters/glue.adapter.js';
import type { AnalyticsWorkflowEvent } from './ports.js';

const analyticsJobs =
  process.env.ANALYTICS_ENGINE === 'glue'
    ? new AwsGlueAdapter(new GlueClient({}), process.env)
    : new AwsEmrAdapter(new EMRServerlessClient({}), process.env);

const service = new AnalyticsWorkflowService(
  new AwsDynamoExportAdapter(new DynamoDBClient({}), process.env),
  analyticsJobs,
);

/** One short action per invocation; Step Functions owns waits, retries and branching. */
export const handler = (event: AnalyticsWorkflowEvent): Promise<unknown> => service.execute(event);
