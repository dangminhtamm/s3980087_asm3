import type { CreateOrderInput, Order } from '../domain/entities/order.js';

export const ORDER_CSV_HEADERS = [
  'orderId',
  'customerName',
  'customerPhone',
  'dropoffAddress',
  'region',
  'lat',
  'lng',
  'status',
  'driverId',
  'timeWindowStart',
  'timeWindowEnd',
  'packageWeightKg',
  'packageVolumeM3',
  'serviceDurationMinutes',
  'routeId',
  'stopSequence',
  'createdAt',
  'deliveredAt',
] as const;

export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field');
  row.push(field.replace(/\r$/, ''));
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
};

const numberOrUndefined = (value: string | undefined): number | undefined =>
  value?.trim() ? Number(value) : undefined;

export const parseOrderCsv = (
  text: string,
): Array<{ row: number; input: Record<string, unknown> }> => {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) return [];
  const header = rows[0]!.map((value) => value.trim());
  const required = ['customerName', 'customerPhone', 'dropoffAddress', 'region', 'lat', 'lng'];
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(', ')}`);
  return rows.slice(1).map((values, index) => {
    const record = Object.fromEntries(
      header.map((name, column) => [name, values[column]?.trim() ?? '']),
    );
    const input: CreateOrderInput = {
      customerName: record.customerName!,
      customerPhone: record.customerPhone!,
      dropoffAddress: record.dropoffAddress!,
      region: record.region!,
      lat: Number(record.lat),
      lng: Number(record.lng),
      timeWindowStart: record.timeWindowStart || null,
      timeWindowEnd: record.timeWindowEnd || null,
      packageWeightKg: numberOrUndefined(record.packageWeightKg),
      packageVolumeM3: numberOrUndefined(record.packageVolumeM3),
      serviceDurationMinutes: numberOrUndefined(record.serviceDurationMinutes),
    };
    return { row: index + 2, input: input as unknown as Record<string, unknown> };
  });
};

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const ordersToCsv = (orders: Order[]): string =>
  [
    ORDER_CSV_HEADERS.join(','),
    ...orders.map((order) => ORDER_CSV_HEADERS.map((header) => csvCell(order[header])).join(',')),
  ].join('\r\n');
