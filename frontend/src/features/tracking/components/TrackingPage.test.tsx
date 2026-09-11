import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

import { TrackingPage } from '../../../pages/TrackingPage';
import type { PublicTrackingData } from '../../../types/tracking';

vi.mock('../../../components/admin/DetailLocationMap', () => ({
  DetailLocationMap: () => <div aria-label="Tracking map" />,
}));

const tracking: PublicTrackingData = {
  reference: 'CF-ORDER1',
  status: 'ASSIGNED',
  customerName: 'Lan Anh',
  destination: { address: '72 Nguyen Hue Street', region: 'District 1', lat: 10.77, lng: 106.7 },
  driver: {
    name: 'Minh Duy',
    vehiclePlate: '51A-482.17',
    lat: null,
    lng: null,
    locationUpdatedAt: null,
  },
  distanceRemainingKm: null,
  estimatedArrivalMinutes: null,
  driverApproaching: false,
  timeline: [{ type: 'ORDER_CREATED', occurredAt: '2026-09-12T00:00:00.000Z' }],
  proof: { confirmed: false, uploadedAt: null, recipientName: null, signatureCaptured: false },
  feedback: null,
  rescheduleRequest: null,
  createdAt: '2026-09-12T00:00:00.000Z',
  deliveredAt: null,
  trackingExpiresAt: '2026-09-20T00:00:00.000Z',
};

const server = setupServer(
  http.get('http://localhost:3000/api/tracking/TRACK-1', () =>
    HttpResponse.json({ data: tracking }),
  ),
  http.post('http://localhost:3000/api/tracking/TRACK-1/reschedule', async ({ request }) => {
    const body = (await request.json()) as {
      requestedWindowStart: string;
      requestedWindowEnd: string;
      notes?: string;
    };
    return HttpResponse.json({
      data: { ...body, notes: body.notes ?? null, requestedAt: '2026-09-12T01:00:00.000Z' },
    });
  }),
);

describe('customer tracking and reschedule', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());

  test('loads the public tracking route and submits a new delivery window', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/track/TRACK-1']}>
        <Routes>
          <Route path="/track/:trackingToken" element={<TrackingPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Your delivery is being prepared.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('From'), '2026-09-13T09:00');
    await user.type(screen.getByLabelText('Until'), '2026-09-13T11:00');
    await user.type(screen.getByPlaceholderText(/Access notes/), 'Please call first');
    await user.click(screen.getByRole('button', { name: 'Request reschedule' }));
    expect(await screen.findByText('Reschedule request pending review')).toBeInTheDocument();
  });
});
