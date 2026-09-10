import { z } from 'zod';

const isoDay = z.iso.date();
const nonNegativeInteger = z.number().int().min(0);

const hourlyVolumeSchema = z.object({
  hour: z.number().int().min(0).max(23),
  orderCount: nonNegativeInteger,
});

const regionalDailyRollupSchema = z.object({
  region: z.string().min(1),
  orderCount: nonNegativeInteger,
  deliveredOrders: nonNegativeInteger,
  totalDeliveryMinutes: z.number().finite().min(0),
  deliveryDurationCount: nonNegativeInteger,
  hourlyOrderVolume: z.array(hourlyVolumeSchema),
});

export const analyticsSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  generatedAt: z.iso.datetime({ offset: true }),
  coverage: z.object({ from: isoDay, to: isoDay }),
  daily: z.array(
    z.object({
      date: isoDay,
      totalOrders: nonNegativeInteger,
      deliveredOrders: nonNegativeInteger,
      totalDeliveryMinutes: z.number().finite().min(0),
      deliveryDurationCount: nonNegativeInteger,
      hourlyOrderVolume: z.array(hourlyVolumeSchema),
      regions: z.array(regionalDailyRollupSchema),
    }),
  ),
});

export const analyticsOverviewQuerySchema = z
  .object({
    from: isoDay.optional(),
    to: isoDay.optional(),
    region: z.string().trim().min(1).max(120).optional(),
  })
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'from must be on or before to',
      });
    }

    if (value.from && value.to) {
      const days = Math.round(
        (Date.parse(`${value.to}T00:00:00.000Z`) -
          Date.parse(`${value.from}T00:00:00.000Z`)) /
          86_400_000,
      );
      if (days > 366) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'Analytics date range cannot exceed 366 days',
        });
      }
    }
  });

export type AnalyticsSnapshot = z.infer<typeof analyticsSnapshotSchema>;
