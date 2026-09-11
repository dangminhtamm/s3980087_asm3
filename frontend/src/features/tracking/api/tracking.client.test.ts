import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { requestCustomerReschedule } from './tracking.client';

const server = setupServer(
  http.post('http://localhost:3000/api/tracking/:token/reschedule', async ({ params, request }) => {
    const body = (await request.json()) as Record<string, string>;
    return HttpResponse.json({
      data: { ...body, requestedAt: '2026-09-12T01:00:00.000Z', notes: body.notes ?? null },
      meta: { requestId: params.token },
    });
  }),
);

describe('tracking reschedule', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());

  test('preserves the public route contract and returns the pending request', async () => {
    const result = await requestCustomerReschedule('TRACK-123', {
      requestedWindowStart: '2026-09-13T01:00:00.000Z',
      requestedWindowEnd: '2026-09-13T03:00:00.000Z',
      notes: 'Please call first',
    });
    expect(result).toMatchObject({
      requestedWindowStart: '2026-09-13T01:00:00.000Z',
      notes: 'Please call first',
    });
  });
});
