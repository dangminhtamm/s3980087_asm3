import { z } from 'zod';

const page = z.enum([
  'home',
  'login',
  'auth-callback',
  'tracking',
  'admin-orders',
  'admin-order',
  'admin-fleet',
  'admin-route',
  'admin-operations',
  'admin-analytics',
  'driver',
  'other',
]);

export const frontendTelemetrySchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('WEB_VITAL'),
      name: z.enum(['LCP', 'INP', 'CLS']),
      value: z.number().finite().nonnegative().max(600_000),
      delta: z.number().finite().nonnegative().max(600_000),
      rating: z.enum(['good', 'needs-improvement', 'poor']),
      page,
      deviceType: z.enum(['mobile', 'desktop']),
      navigationType: z.string().trim().min(1).max(40),
    })
    .strict(),
  z
    .object({
      type: z.literal('OFFLINE_OUTBOX'),
      event: z.enum(['queued', 'flush']),
      size: z.number().int().nonnegative().max(100_000),
      retryCount: z.number().int().nonnegative().max(100_000),
      conflictCount: z.number().int().nonnegative().max(100_000),
      completedCount: z.number().int().nonnegative().max(100_000),
      durationMs: z.number().finite().nonnegative().max(3_600_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('POD_UPLOAD'),
      outcome: z.enum(['success', 'error']),
      durationMs: z.number().finite().nonnegative().max(3_600_000),
      sizeBytes: z
        .number()
        .int()
        .positive()
        .max(10 * 1024 * 1024),
    })
    .strict(),
]);

export type FrontendTelemetry = z.infer<typeof frontendTelemetrySchema>;
