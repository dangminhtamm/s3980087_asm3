import { z } from 'zod';

import {
  ORDER_EXCEPTION_REASONS,
  ORDER_STATUSES,
  type Order,
} from '../../../domain/entities/order.js';

const nullableString = z.string().nullable().default(null);

const orderSchema = z.object({
  orderId: z.string().min(1),
  customerName: z.string(),
  customerPhone: z.string(),
  dropoffAddress: z.string(),
  region: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  status: z.enum(ORDER_STATUSES),
  driverId: nullableString,
  createdAt: z.string(),
  deliveredAt: nullableString,
  exception: z
    .object({
      reason: z.enum(ORDER_EXCEPTION_REASONS),
      notes: nullableString,
      reportedAt: z.string(),
      reportedBy: z.string(),
    })
    .nullable()
    .default(null),
  timeWindowStart: nullableString,
  timeWindowEnd: nullableString,
  packageWeightKg: z.number().finite().nonnegative().default(0),
  packageVolumeM3: z.number().finite().nonnegative().default(0),
  serviceDurationMinutes: z.number().finite().nonnegative().default(10),
  routeId: nullableString,
  stopSequence: z.number().int().positive().nullable().default(null),
  startedAt: nullableString,
  arrivedAt: nullableString,
  plannedArrivalAt: nullableString,
  customerRescheduleRequest: z
    .object({
      requestedWindowStart: z.string(),
      requestedWindowEnd: z.string(),
      notes: nullableString,
      requestedAt: z.string(),
    })
    .nullable()
    .default(null),
});

export const mapOrderItem = (item: unknown): Order => orderSchema.parse(item);
