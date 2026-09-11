import { z } from 'zod';

import {
  ALLOWED_PROOF_CONTENT_TYPES,
  MAX_PROOF_FILE_SIZE_BYTES,
} from '../domain/entities/delivery-proof.js';
import {
  ORDER_EXCEPTION_REASONS,
  ORDER_STATUSES,
  UPDATABLE_ORDER_STATUSES,
} from '../domain/entities/order.js';

export const createOrderSchema = z
  .object({
    customerName: z.string().trim().min(1).max(120),
    customerPhone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, {
        message: 'customerPhone must use E.164 format, for example +84901234567',
      }),
    dropoffAddress: z.string().trim().min(5).max(500),
    region: z.string().trim().min(1).max(120),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    driverId: z.string().trim().min(1).max(100).nullable().optional(),
    timeWindowStart: z.iso.datetime({ offset: true }).nullable().optional(),
    timeWindowEnd: z.iso.datetime({ offset: true }).nullable().optional(),
    packageWeightKg: z.number().finite().min(0).max(10_000).default(0),
    packageVolumeM3: z.number().finite().min(0).max(100).default(0),
    serviceDurationMinutes: z.number().int().min(1).max(480).default(10),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.timeWindowStart &&
      value.timeWindowEnd &&
      value.timeWindowStart >= value.timeWindowEnd
    ) {
      context.addIssue({
        code: 'custom',
        path: ['timeWindowEnd'],
        message: 'timeWindowEnd must be after timeWindowStart',
      });
    }
  });

export const orderIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const updateOrderStatusSchema = z
  .object({
    status: z.enum(UPDATABLE_ORDER_STATUSES),
    reason: z.enum(ORDER_EXCEPTION_REASONS).optional(),
    notes: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === 'DELIVERY_FAILED' || value.status === 'CANCELLED') && !value.reason) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: `reason is required when status is ${value.status}`,
      });
    }
  });

export const listOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  driverId: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const exportOrdersQuerySchema = listOrdersQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(100),
});

export const assignDriverSchema = z
  .object({
    driverId: z.string().trim().min(1).max(100),
  })
  .strict();

export const uploadUrlQuerySchema = z.object({
  orderId: z.string().uuid(),
  contentType: z.enum(ALLOWED_PROOF_CONTENT_TYPES),
});

export const proofUploadQuerySchema = z.object({
  contentType: z.enum(ALLOWED_PROOF_CONTENT_TYPES),
});

export const registerDeliveryProofSchema = z
  .object({
    objectKey: z.string().trim().min(1).max(1024),
    contentType: z.enum(ALLOWED_PROOF_CONTENT_TYPES),
    size: z.number().int().min(1).max(MAX_PROOF_FILE_SIZE_BYTES),
    recipientName: z.string().trim().min(1).max(120).optional(),
    signatureDataUrl: z
      .string()
      .max(200_000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'signatureDataUrl must be a PNG data URL')
      .optional(),
    barcode: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:/-]{3,128}$/)
      .optional(),
    notes: z.string().trim().min(1).max(500).optional(),
    gps: z
      .object({
        lat: z.number().finite().min(-90).max(90),
        lng: z.number().finite().min(-180).max(180),
        accuracy: z.number().finite().min(0).max(100_000).nullable(),
        recordedAt: z.iso.datetime({ offset: true }),
      })
      .strict()
      .optional(),
  })
  .strict();
