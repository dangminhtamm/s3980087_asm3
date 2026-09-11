import type { ApiEnvelope, DriverDto } from '../../../packages/contracts/index.js';
import type { LocalApiClient } from './api-client.js';

export const proofPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export const createAvailableDriver = async (api: LocalApiClient): Promise<DriverDto> => {
  const suffix = Date.now().toString().slice(-6);
  const response = await api.request<ApiEnvelope<DriverDto>>('/api/drivers', {
    method: 'POST',
    body: JSON.stringify({
      name: `E2E Driver ${suffix}`,
      phone: `+8491${suffix}00`,
      vehiclePlate: `E2E-${suffix}`,
      currentArea: 'District 1',
    }),
  });
  return response.data;
};

export const newOrderFixture = () => ({
  customerName: `E2E Customer ${Date.now()}`,
  customerPhone: '+84901234567',
  dropoffAddress: '72 Nguyen Hue Street, District 1, Ho Chi Minh City',
  region: 'District 1',
  lat: 10.77428,
  lng: 106.70391,
});
