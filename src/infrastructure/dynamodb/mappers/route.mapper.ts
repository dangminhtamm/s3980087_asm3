import { z } from 'zod';

import { ROUTE_STATUSES, type Route } from '../../../domain/entities/route.js';

const pointSchema = z.object({ lat: z.number(), lng: z.number() });
const optimizationSchema = z.object({
  provider: z.string(),
  mode: z.enum(['AUTO', 'MANUAL']),
  optimizedAt: z.string(),
  revision: z.number().int().positive(),
});

const routeMetadataSchema = z
  .object({
    routeId: z.string().min(1),
    driverId: z.string().min(1),
    scheduledDate: z.string(),
    status: z.enum(ROUTE_STATUSES),
    stopCount: z.number().nonnegative(),
    totalWeightKg: z.number().nonnegative(),
    totalVolumeM3: z.number().nonnegative(),
    createdAt: z.string(),
    createdBy: z.string(),
    origin: pointSchema.default({ lat: 10.7769, lng: 106.7009 }),
    plannedDistanceMeters: z.number().nonnegative().default(0),
    plannedDurationSeconds: z.number().nonnegative().default(0),
    geometry: z.array(z.tuple([z.number(), z.number()])).default([]),
    optimization: optimizationSchema.optional(),
  })
  .transform((item) => ({
    ...item,
    optimization: item.optimization ?? {
      provider: 'legacy',
      mode: 'MANUAL' as const,
      optimizedAt: item.createdAt,
      revision: 1,
    },
  }));

const routeStopRecordSchema = z.object({
  SK: z.string().startsWith('STOP#'),
  orderId: z.string(),
  sequence: z.coerce.number().int().positive(),
  plannedArrivalAt: z.string().optional(),
  plannedDepartureAt: z.string().optional(),
  plannedTravelDurationSeconds: z.coerce.number().nonnegative().default(0),
  plannedDistanceMeters: z.coerce.number().nonnegative().default(0),
});

export type StoredRoute = Omit<Route, 'stops' | 'comparison'>;
export type StoredRouteStop = z.output<typeof routeStopRecordSchema>;

export const mapRouteMetadata = (item: unknown): StoredRoute => routeMetadataSchema.parse(item);
export const mapRouteStop = (item: unknown): StoredRouteStop => routeStopRecordSchema.parse(item);
