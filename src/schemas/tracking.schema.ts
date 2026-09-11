import { z } from 'zod';

export const trackingTokenParamsSchema = z.object({
  trackingToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid tracking token'),
});

export const customerFeedbackSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const customerRescheduleSchema = z
  .object({
    requestedWindowStart: z.iso.datetime({ offset: true }),
    requestedWindowEnd: z.iso.datetime({ offset: true }),
    notes: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.requestedWindowStart >= value.requestedWindowEnd) {
      context.addIssue({
        code: 'custom',
        path: ['requestedWindowEnd'],
        message: 'requestedWindowEnd must be after requestedWindowStart',
      });
    }
    if (Date.parse(value.requestedWindowEnd) <= Date.now()) {
      context.addIssue({
        code: 'custom',
        path: ['requestedWindowEnd'],
        message: 'requested delivery window must be in the future',
      });
    }
  });
