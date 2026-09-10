import { z } from 'zod';

import { DRIVER_STATUSES } from '../domain/entities/driver.js';

export const createDriverSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, {
      message: 'phone must use E.164 format, for example +84901234567',
    }),
    vehiclePlate: z.string().trim().min(5).max(20),
    currentArea: z.string().trim().min(1).max(120),
    maxWeightKg: z.number().finite().positive().max(10_000).default(20),
    maxVolumeM3: z.number().finite().positive().max(100).default(0.25),
  })
  .strict();

export const listDriversQuerySchema = z.object({
  status: z.enum(DRIVER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const driverIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(100),
});

export const updateDriverStatusSchema = z
  .object({ status: z.enum(DRIVER_STATUSES) })
  .strict();

export const updateDriverLocationSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().min(0).max(10_000).optional(),
    recordedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
