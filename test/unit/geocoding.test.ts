import assert from 'node:assert/strict';
import test from 'node:test';

import { GeocodingService } from '../../src/services/geocoding.service.js';

test('geocoding normalizes and caches provider results', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify([{ place_id: 7, display_name: '72 Nguyen Hue, Ho Chi Minh City', lat: '10.774', lon: '106.704', importance: 0.8, address: { city: 'Ho Chi Minh City' } }]));
  };
  const service = new GeocodingService('nominatim', 'https://example.test', 'test', 0, fetcher);
  const first = await service.validate('72 Nguyen Hue', 'vn', 3);
  const second = await service.validate('72 Nguyen Hue', 'vn', 3);
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.equal(first[0]?.region, 'Ho Chi Minh City');
});
