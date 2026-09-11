import type { z } from 'zod';

import { AppError } from '../errors/app-error.js';
import { createOrderSchema, listOrdersQuerySchema } from '../schemas/order.schema.js';
import { ordersToCsv, parseOrderCsv } from '../utils/order-csv.js';
import type { OrderService } from './order.service.js';

type ListOrdersInput = z.infer<typeof listOrdersQuerySchema>;

export interface OrderImportResult {
  created: number;
  failed: number;
  results: Array<{
    row: number;
    orderId?: string;
    error?: { code: string; message: string };
  }>;
}

export interface OrderExportResult {
  filename: string;
  content: string;
}

export class OrderCsvService {
  public constructor(private readonly orders: OrderService) {}

  public async importOrders(csv: unknown, actorId: string): Promise<OrderImportResult> {
    if (typeof csv !== 'string') {
      throw new AppError(
        415,
        'Send the CSV file with Content-Type: text/csv',
        'CSV_CONTENT_TYPE_REQUIRED',
      );
    }

    let parsed: ReturnType<typeof parseOrderCsv>;
    try {
      parsed = parseOrderCsv(csv);
    } catch (error: unknown) {
      throw new AppError(
        400,
        error instanceof Error ? error.message : 'Invalid CSV',
        'INVALID_CSV',
      );
    }

    if (parsed.length === 0) throw new AppError(400, 'CSV has no data rows', 'EMPTY_CSV');
    if (parsed.length > 100) {
      throw new AppError(413, 'A CSV import is limited to 100 orders', 'CSV_ROW_LIMIT');
    }

    const results: OrderImportResult['results'] = [];
    for (const entry of parsed) {
      const validation = createOrderSchema.safeParse(entry.input);
      if (!validation.success) {
        results.push({
          row: entry.row,
          error: {
            code: 'VALIDATION_ERROR',
            message: validation.error.issues[0]?.message ?? 'Invalid row',
          },
        });
        continue;
      }

      try {
        const order = await this.orders.createOrder(validation.data, actorId);
        results.push({ row: entry.row, orderId: order.orderId });
      } catch (error: unknown) {
        results.push({
          row: entry.row,
          error: {
            code: error instanceof AppError ? error.code : 'IMPORT_FAILED',
            message: error instanceof Error ? error.message : 'Import failed',
          },
        });
      }
    }

    const created = results.filter((result) => result.orderId).length;
    return { created, failed: results.length - created, results };
  }

  public async exportOrders(input: ListOrdersInput): Promise<OrderExportResult> {
    const orders = await this.orders.listOrders(input);
    const date = new Date().toISOString().slice(0, 10);
    return {
      filename: `cloudfleet-orders-${date}.csv`,
      content: ordersToCsv(orders),
    };
  }
}
