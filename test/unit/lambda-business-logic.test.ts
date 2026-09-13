import assert from 'node:assert/strict';
import test from 'node:test';

import type { GlueClient } from '@aws-sdk/client-glue';
import { AnalyticsWorkflowService } from '../../src/lambdas/analytics-workflow/analytics-workflow.service.js';
import { AwsGlueAdapter } from '../../src/lambdas/analytics-workflow/adapters/glue.adapter.js';
import type {
  AnalyticsJobPort,
  DynamoExportPort,
} from '../../src/lambdas/analytics-workflow/ports.js';
import { DeliveryNotificationService } from '../../src/lambdas/delivery-notification/delivery-notification.service.js';
import type {
  DeliveryStatusChange,
  NotificationEventPort,
  NotificationLogger,
  SmsPort,
  TrackingLinkPort,
} from '../../src/lambdas/delivery-notification/ports.js';
import { RealtimeConnectionsService } from '../../src/lambdas/realtime-connections/realtime-connections.service.js';
import type { RealtimeConnectionPort } from '../../src/lambdas/realtime-connections/ports.js';

test('delivery notification business logic runs with in-memory ports', async () => {
  const sent: Array<{ phone: string; message: string }> = [];
  const recorded: Array<{ type: string; metadata: Record<string, string> }> = [];
  const sms: SmsPort = {
    send: (phone, message) => {
      sent.push({ phone, message });
      return Promise.resolve('SM-TEST');
    },
  };
  const links: TrackingLinkPort = {
    getForOrder: () => Promise.resolve('https://tracking.example/track/token'),
  };
  const events: NotificationEventPort = {
    record: (_change, type, metadata) => {
      recorded.push({ type, metadata });
      return Promise.resolve();
    },
  };
  const logger: NotificationLogger = { info: () => undefined, error: () => undefined };
  const service = new DeliveryNotificationService(sms, links, events, logger);
  const change: DeliveryStatusChange = {
    eventId: 'event-1',
    orderId: 'order-1',
    customerPhone: '+84901234567',
    previousStatus: 'ARRIVED',
    status: 'DELIVERED',
    occurredAt: '2026-09-12T00:00:00.000Z',
  };

  await service.process(change);

  assert.equal(sent.length, 1);
  assert.match(sent[0]!.message, /View confirmation/);
  assert.deepEqual(recorded, [
    {
      type: 'SMS_NOTIFICATION_SENT',
      metadata: {
        provider: 'Twilio',
        messageSid: 'SM-TEST',
        status: 'DELIVERED',
        trackingLinkIncluded: 'true',
      },
    },
  ]);
});

test('delivery notification ignores unchanged and invalid-phone records without providers', async () => {
  let sends = 0;
  const service = new DeliveryNotificationService(
    {
      send: () => {
        sends += 1;
        return Promise.resolve('unused');
      },
    },
    { getForOrder: () => Promise.resolve(null) },
    { record: () => Promise.resolve() },
    { info: () => undefined, error: () => undefined },
  );
  await service.process({
    eventId: 'event-1',
    orderId: 'order-1',
    customerPhone: '+84901234567',
    previousStatus: 'ARRIVED',
    status: 'ARRIVED',
    occurredAt: '2026-09-12T00:00:00.000Z',
  });
  await service.process({
    eventId: 'event-2',
    orderId: 'order-2',
    customerPhone: 'invalid',
    previousStatus: 'ARRIVED',
    status: 'DELIVERED',
    occurredAt: '2026-09-12T00:00:00.000Z',
  });
  assert.equal(sends, 0);
});

test('analytics workflow dispatches through DynamoDB and Spark job ports', async () => {
  const calls: string[] = [];
  const exports: DynamoExportPort = {
    start: (runId) => {
      calls.push(`export:start:${runId}`);
      return Promise.resolve({ runId });
    },
    check: (runId, arn) => {
      calls.push(`export:check:${runId}:${arn}`);
      return Promise.resolve({});
    },
  };
  const jobs: AnalyticsJobPort = {
    start: (runId, uri) => {
      calls.push(`job:start:${runId}:${uri}`);
      return Promise.resolve({});
    },
    check: (runId, jobId) => {
      calls.push(`job:check:${runId}:${jobId}`);
      return Promise.resolve({});
    },
  };
  const service = new AnalyticsWorkflowService(exports, jobs);

  await service.execute({ action: 'START_EXPORT', runId: ' run-1 ' });
  await service.execute({ action: 'CHECK_EXPORT', runId: 'run-1', exportArn: 'arn:export' });
  await service.execute({ action: 'START_JOB', runId: 'run-1', inputUri: 's3://input' });
  await service.execute({ action: 'CHECK_JOB', runId: 'run-1', jobRunId: 'job-1' });

  assert.deepEqual(calls, [
    'export:start:run-1',
    'export:check:run-1:arn:export',
    'job:start:run-1:s3://input',
    'job:check:run-1:job-1',
  ]);
});

test('Glue adapter starts the configured job and normalizes terminal status', async () => {
  const inputs: unknown[] = [];
  const client = {
    send: (command: unknown) => {
      const typed = command as { constructor: { name: string }; input: unknown };
      inputs.push(typed.input);
      return Promise.resolve(
        typed.constructor.name === 'StartJobRunCommand'
          ? { JobRunId: 'glue-run-1' }
          : { JobRun: { JobRunState: 'SUCCEEDED' } },
      );
    },
  } as unknown as GlueClient;
  const adapter = new AwsGlueAdapter(client, {
    GLUE_JOB_NAME: 'cloudfleet-dev-delivery-analytics',
    ANALYTICS_BUCKET: 'cloudfleet-dev-analytics',
  });

  assert.deepEqual(await adapter.start('run-1', 's3://exports/run-1/data/'), {
    runId: 'run-1',
    jobRunId: 'glue-run-1',
  });
  assert.deepEqual(await adapter.check('run-1', 'glue-run-1'), {
    runId: 'run-1',
    jobRunId: 'glue-run-1',
    status: 'SUCCESS',
    stateDetails: null,
  });
  assert.deepEqual(inputs[0], {
    JobName: 'cloudfleet-dev-delivery-analytics',
    Arguments: {
      '--input-uri': 's3://exports/run-1/data/',
      '--output-bucket': 'cloudfleet-dev-analytics',
      '--output-key': 'analytics/latest/overview.json',
    },
  });
});

test('realtime connection logic consumes tickets through an in-memory port', async () => {
  const saved: string[] = [];
  const connections: RealtimeConnectionPort = {
    consumeTicket: () =>
      Promise.resolve({
        subject: 'subject-1',
        username: 'driver-1',
        roles: ['DRIVER'],
        expiresAt: 200,
      }),
    saveConnection: (connectionId, _identity, expiresAt) => {
      saved.push(`${connectionId}:${expiresAt}`);
      return Promise.resolve();
    },
    deleteConnection: () => Promise.resolve(),
  };
  const service = new RealtimeConnectionsService(connections, () => 100);

  assert.equal(await service.connect('ticket', 'connection-1'), true);
  assert.deepEqual(saved, ['connection-1:7300']);
});
