import assert from 'node:assert/strict';
import test from 'node:test';

import { ordersToCsv, parseCsv, parseOrderCsv } from '../../src/utils/order-csv.js';

test('CSV parser supports quoted commas, escaped quotes and CRLF', () => {
  assert.deepEqual(parseCsv('name,address\r\n"Lan ""A""","1 Main St, D1"\r\n'), [
    ['name', 'address'], ['Lan "A"', '1 Main St, D1'],
  ]);
});

test('order CSV parser maps operational constraints', () => {
  const parsed = parseOrderCsv('customerName,customerPhone,dropoffAddress,region,lat,lng,packageWeightKg,packageVolumeM3,serviceDurationMinutes\nLan,+84901234567,1 Main Street,D1,10.7,106.7,2.5,0.03,15');
  assert.equal(parsed[0]?.row, 2);
  assert.deepEqual(parsed[0]?.input, {
    customerName: 'Lan', customerPhone: '+84901234567', dropoffAddress: '1 Main Street', region: 'D1',
    lat: 10.7, lng: 106.7, timeWindowStart: null, timeWindowEnd: null,
    packageWeightKg: 2.5, packageVolumeM3: 0.03, serviceDurationMinutes: 15,
  });
});

test('CSV export protects fields containing commas', () => {
  const csv = ordersToCsv([{ customerName: 'Lan, Anh' } as never]);
  assert.match(csv, /"Lan, Anh"/);
});
