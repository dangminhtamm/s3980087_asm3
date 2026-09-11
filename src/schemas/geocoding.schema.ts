import { z } from 'zod';

export const validateAddressSchema = z
  .object({
    address: z.string().trim().min(5).max(500),
    countryCode: z.string().trim().length(2).toLowerCase().default('vn'),
    limit: z.number().int().min(1).max(5).default(3),
  })
  .strict();
