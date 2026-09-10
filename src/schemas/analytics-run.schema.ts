import { z } from 'zod';

export const analyticsRunParamsSchema = z.object({
  runId: z.uuid(),
});
