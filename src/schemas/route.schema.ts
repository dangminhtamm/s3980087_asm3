import { z } from 'zod';

export const createRouteSchema = z.object({
  driverId: z.string().trim().min(1).max(100),
  orderIds: z.array(z.string().uuid()).min(1).max(25),
  scheduledDate: z.iso.date().default(() => new Date().toISOString().slice(0, 10)),
  optimize: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (new Set(value.orderIds).size !== value.orderIds.length) {
    context.addIssue({ code: 'custom', path: ['orderIds'], message: 'orderIds must be unique' });
  }
});

export const routeIdParamsSchema = z.object({ id: z.string().uuid() });

export const listRoutesQuerySchema = z.object({
  driverId: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const reorderRouteSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(25),
}).strict().superRefine((value, context) => {
  if (new Set(value.orderIds).size !== value.orderIds.length) {
    context.addIssue({ code: 'custom', path: ['orderIds'], message: 'orderIds must be unique' });
  }
});

export const reoptimizeRouteSchema = z.object({
  departureAt: z.iso.datetime({ offset: true }).optional(),
}).strict();
