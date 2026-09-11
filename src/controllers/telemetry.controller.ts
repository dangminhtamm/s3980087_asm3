import type { NextFunction, Request, Response } from 'express';

import { emitMetrics, type MetricValue } from '../observability/metrics.js';
import { frontendTelemetrySchema } from '../schemas/telemetry.schema.js';

export class TelemetryController {
  public collect = (request: Request, response: Response, next: NextFunction): void => {
    try {
      const telemetry = frontendTelemetrySchema.parse(request.body);

      if (telemetry.type === 'WEB_VITAL') {
        const metricName = `WebVital${telemetry.name}`;
        emitMetrics(
          [
            {
              name: metricName,
              value: telemetry.value,
              unit: telemetry.name === 'CLS' ? 'None' : 'Milliseconds',
            },
          ],
          {
            Vital: telemetry.name,
            Rating: telemetry.rating,
            Page: telemetry.page,
            DeviceType: telemetry.deviceType,
          },
          { navigationType: telemetry.navigationType, delta: telemetry.delta },
        );
      } else if (telemetry.type === 'OFFLINE_OUTBOX') {
        const metrics: MetricValue[] = [
          { name: 'OfflineOutboxSize', value: telemetry.size, unit: 'Count' },
          { name: 'OfflineOutboxRetryCount', value: telemetry.retryCount, unit: 'Count' },
          { name: 'OfflineOutboxConflictCount', value: telemetry.conflictCount, unit: 'Count' },
          { name: 'OfflineOutboxCompletedCount', value: telemetry.completedCount, unit: 'Count' },
          { name: 'OfflineOutboxFlushDuration', value: telemetry.durationMs, unit: 'Milliseconds' },
        ];
        emitMetrics(metrics, { Event: telemetry.event });
      } else {
        emitMetrics(
          [
            { name: 'PodUploadDuration', value: telemetry.durationMs, unit: 'Milliseconds' },
            { name: 'PodUploadBytes', value: telemetry.sizeBytes, unit: 'Bytes' },
            { name: 'PodUploadAttemptCount', value: 1, unit: 'Count' },
            ...(telemetry.outcome === 'success'
              ? [{ name: 'PodUploadSuccessCount', value: 1, unit: 'Count' as const }]
              : [{ name: 'PodUploadFailureCount', value: 1, unit: 'Count' as const }]),
          ],
          { Outcome: telemetry.outcome },
        );
      }

      response.status(202).end();
    } catch (error: unknown) {
      next(error);
    }
  };
}
