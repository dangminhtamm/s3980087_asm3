import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { EMRServerlessClient } from '@aws-sdk/client-emr-serverless';
import { AnalyticsWorkflowService } from './analytics-workflow.service.js';
import { AwsDynamoExportAdapter } from './adapters/dynamodb-export.adapter.js';
import { AwsEmrAdapter } from './adapters/emr.adapter.js';
import type { AnalyticsWorkflowEvent } from './ports.js';

const service = new AnalyticsWorkflowService(
  new AwsDynamoExportAdapter(new DynamoDBClient({}), process.env),
  new AwsEmrAdapter(new EMRServerlessClient({}), process.env),
);

/** One short action per invocation; Step Functions owns waits, retries and branching. */
export const handler = (event: AnalyticsWorkflowEvent): Promise<unknown> => service.execute(event);
