import { z } from 'zod';

export const operationalIssuesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
