import type { MetadataBearer, MiddlewareStack } from '@smithy/types';

const DEFAULT_NAMESPACE = 'CloudFleet/Observability';

export type MetricUnit = 'Count' | 'Milliseconds' | 'Bytes' | 'None' | 'Percent';

export interface MetricValue {
  name: string;
  value: number;
  unit: MetricUnit;
}

type DimensionValue = string | number | boolean;

const safeDimension = (value: DimensionValue): string =>
  String(value)
    .replace(/[\r\n]/g, ' ')
    .slice(0, 255);

/**
 * Writes CloudWatch Embedded Metric Format (EMF) as a single structured log.
 * Locally this remains useful JSON; in ECS/Lambda CloudWatch extracts metrics
 * without adding a synchronous network call to the request path.
 */
export const emitMetrics = (
  metrics: MetricValue[],
  dimensions: Record<string, DimensionValue> = {},
  properties: Record<string, unknown> = {},
): void => {
  const finiteMetrics = metrics.filter(({ value }) => Number.isFinite(value));
  if (finiteMetrics.length === 0) return;

  const allDimensions = {
    Service: process.env.METRICS_SERVICE_NAME?.trim() || 'cloudfleet-api',
    Environment:
      process.env.OBSERVABILITY_ENVIRONMENT?.trim() || process.env.NODE_ENV?.trim() || 'local',
    ...dimensions,
  };
  const dimensionNames = Object.keys(allDimensions).sort();
  const payload: Record<string, unknown> = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: process.env.METRICS_NAMESPACE?.trim() || DEFAULT_NAMESPACE,
          Dimensions: [dimensionNames],
          Metrics: finiteMetrics.map(({ name, unit }) => ({ Name: name, Unit: unit })),
        },
      ],
    },
    ...Object.fromEntries(
      Object.entries(allDimensions).map(([key, value]) => [key, safeDimension(value)]),
    ),
    ...properties,
  };

  for (const { name, value } of finiteMetrics) payload[name] = value;
  console.info(JSON.stringify(payload));
};

export const durationMsSince = (startedAt: bigint): number =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000;

const CAPACITY_COMMANDS = new Set([
  'BatchGetCommand',
  'BatchGetItemCommand',
  'BatchWriteCommand',
  'BatchWriteItemCommand',
  'DeleteCommand',
  'DeleteItemCommand',
  'GetCommand',
  'GetItemCommand',
  'PutCommand',
  'PutItemCommand',
  'QueryCommand',
  'ScanCommand',
  'TransactGetCommand',
  'TransactGetItemsCommand',
  'TransactWriteCommand',
  'TransactWriteItemsCommand',
  'UpdateCommand',
  'UpdateItemCommand',
]);

const consumedCapacity = (
  output: Record<string, unknown>,
): {
  total: number;
  read?: number;
  write?: number;
} => {
  const raw = output.ConsumedCapacity;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];
  let total = 0;
  let read = 0;
  let write = 0;
  let hasRead = false;
  let hasWrite = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const value = entry as Record<string, unknown>;
    if (typeof value.CapacityUnits === 'number') total += value.CapacityUnits;
    if (typeof value.ReadCapacityUnits === 'number') {
      read += value.ReadCapacityUnits;
      hasRead = true;
    }
    if (typeof value.WriteCapacityUnits === 'number') {
      write += value.WriteCapacityUnits;
      hasWrite = true;
    }
  }
  return {
    total,
    ...(hasRead ? { read } : {}),
    ...(hasWrite ? { write } : {}),
  };
};

/** Adds low-overhead timing/capacity instrumentation to an AWS SDK v3 client. */
export const instrumentAwsClient = <Input extends object, Output extends MetadataBearer>(
  middlewareStack: MiddlewareStack<Input, Output>,
  service: 'DynamoDB' | 'S3',
): void => {
  middlewareStack.add(
    (next, context) => async (arguments_) => {
      const operation = (context.commandName || 'UnknownCommand').replace(/Command$/, '');
      const input = arguments_.input as Record<string, unknown> | undefined;
      if (service === 'DynamoDB' && input && CAPACITY_COMMANDS.has(context.commandName || '')) {
        input.ReturnConsumedCapacity = 'TOTAL';
      }

      const startedAt = process.hrtime.bigint();
      try {
        const result = await next(arguments_);
        const output = result.output as Record<string, unknown>;
        const metrics: MetricValue[] = [
          {
            name: `${service}RequestDuration`,
            value: durationMsSince(startedAt),
            unit: 'Milliseconds',
          },
          {
            name: `${service}RequestCount`,
            value: 1,
            unit: 'Count',
          },
        ];
        if (service === 'DynamoDB') {
          const capacity = consumedCapacity(output);
          metrics.push({ name: 'DynamoDBConsumedCapacity', value: capacity.total, unit: 'Count' });
          if (capacity.read !== undefined) {
            metrics.push({
              name: 'DynamoDBConsumedReadCapacity',
              value: capacity.read,
              unit: 'Count',
            });
          }
          if (capacity.write !== undefined) {
            metrics.push({
              name: 'DynamoDBConsumedWriteCapacity',
              value: capacity.write,
              unit: 'Count',
            });
          }
          const returnedCount =
            typeof output.Count === 'number'
              ? output.Count
              : Array.isArray(output.Items)
                ? output.Items.length
                : undefined;
          if (returnedCount !== undefined) {
            metrics.push({
              name: 'DynamoDBReturnedItemCount',
              value: returnedCount,
              unit: 'Count',
            });
          }
          if (typeof output.ScannedCount === 'number') {
            metrics.push({
              name: 'DynamoDBScannedItemCount',
              value: output.ScannedCount,
              unit: 'Count',
            });
          }
        }
        emitMetrics(metrics, { Dependency: service, Operation: operation });
        return result;
      } catch (error: unknown) {
        emitMetrics(
          [
            {
              name: `${service}RequestDuration`,
              value: durationMsSince(startedAt),
              unit: 'Milliseconds',
            },
            { name: `${service}RequestCount`, value: 1, unit: 'Count' },
            { name: `${service}ErrorCount`, value: 1, unit: 'Count' },
          ],
          { Dependency: service, Operation: operation },
          {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
        );
        throw error;
      }
    },
    { step: 'initialize', name: `cloudFleet${service}Observability`, priority: 'low' },
  );
};
