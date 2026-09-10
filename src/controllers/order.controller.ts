import type { NextFunction, Request, Response } from 'express';

import {
  createOrderSchema,
  assignDriverSchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  updateOrderStatusSchema,
  uploadUrlQuerySchema,
} from '../schemas/order.schema.js';
import type { OrderService } from '../services/order.service.js';
import type { OrderEventService } from '../services/order-event.service.js';
import { createProofOfDeliveryUploadUrl } from '../utils/s3-presigned-url.js';
import { ordersToCsv, parseOrderCsv } from '../utils/order-csv.js';
import { AppError } from '../errors/app-error.js';
import type { PushService } from '../services/push.service.js';

export class OrderController {
  public constructor(private readonly orderService: OrderService, private readonly orderEvents: OrderEventService, private readonly push?: PushService) {}

  public createOrder = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createOrderSchema.parse(request.body);
      const order = await this.orderService.createOrder(input, request.authenticatedUser!.username);

      response.status(201).json({ data: order });
    } catch (error: unknown) {
      next(error);
    }
  };

  public updateStatus = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const input = updateOrderStatusSchema.parse(request.body);
      const order = await this.orderService.updateStatus(id, input, request.authenticatedUser!.username);

      response.status(200).json({ data: order });
    } catch (error: unknown) {
      next(error);
    }
  };

  public listOrders = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = listOrdersQuerySchema.parse(request.query);
      const user = request.authenticatedUser!;
      const scopedInput = user.roles.includes('ADMIN')
        ? input
        : { ...input, driverId: user.username };
      const orders = await this.orderService.listOrders(scopedInput);

      response.status(200).json({ data: orders });
    } catch (error: unknown) {
      next(error);
    }
  };

  public getOrder = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const order = await this.orderService.getOrder(id);

      response.status(200).json({ data: order });
    } catch (error: unknown) {
      next(error);
    }
  };

  public getTrackingLink = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      response.status(200).json({ data: await this.orderService.getTrackingLink(id) });
    } catch (error: unknown) {
      next(error);
    }
  };

  public assignDriver = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const { driverId } = assignDriverSchema.parse(request.body);
      const order = await this.orderService.assignDriver(id, driverId, request.authenticatedUser!.username);

      await this.push?.notifyDriver(driverId, {
        title: 'New CloudFleet delivery',
        body: `${order.customerName} · ${order.dropoffAddress}`,
        url: `/driver?order=${order.orderId}`,
        tag: `order-${order.orderId}`,
      });

      response.status(200).json({ data: order });
    } catch (error: unknown) {
      next(error);
    }
  };

  public getUploadUrl = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { orderId, contentType } = uploadUrlQuerySchema.parse(request.query);

      await this.orderService.assertCanUploadProof(orderId);
      const upload = await createProofOfDeliveryUploadUrl(orderId, contentType);

      response.status(200).json({ data: upload });
    } catch (error: unknown) {
      next(error);
    }
  };

  public listEvents = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const order = await this.orderService.getOrder(id);
      response.status(200).json({ data: await this.orderEvents.list(order) });
    } catch (error: unknown) {
      next(error);
    }
  };

  public importCsv = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (typeof request.body !== 'string') {
        throw new AppError(415, 'Send the CSV file with Content-Type: text/csv', 'CSV_CONTENT_TYPE_REQUIRED');
      }
      let parsed: ReturnType<typeof parseOrderCsv>;
      try { parsed = parseOrderCsv(request.body); }
      catch (error: unknown) {
        throw new AppError(400, error instanceof Error ? error.message : 'Invalid CSV', 'INVALID_CSV');
      }
      if (parsed.length === 0) throw new AppError(400, 'CSV has no data rows', 'EMPTY_CSV');
      if (parsed.length > 100) throw new AppError(413, 'A CSV import is limited to 100 orders', 'CSV_ROW_LIMIT');

      const results: Array<{ row: number; orderId?: string; error?: { code: string; message: string } }> = [];
      for (const entry of parsed) {
        const validation = createOrderSchema.safeParse(entry.input);
        if (!validation.success) {
          results.push({ row: entry.row, error: { code: 'VALIDATION_ERROR', message: validation.error.issues[0]?.message ?? 'Invalid row' } });
          continue;
        }
        try {
          const order = await this.orderService.createOrder(validation.data, request.authenticatedUser!.username);
          results.push({ row: entry.row, orderId: order.orderId });
        } catch (error: unknown) {
          results.push({ row: entry.row, error: {
            code: error instanceof AppError ? error.code : 'IMPORT_FAILED',
            message: error instanceof Error ? error.message : 'Import failed',
          } });
        }
      }
      const created = results.filter((result) => result.orderId).length;
      const failed = results.length - created;
      response.status(failed ? 207 : 201).json({ data: { created, failed, results } });
    } catch (error: unknown) { next(error); }
  };

  public exportCsv = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = listOrdersQuerySchema.parse({ ...request.query, limit: request.query.limit ?? 100 });
      const orders = await this.orderService.listOrders(input);
      const date = new Date().toISOString().slice(0, 10);
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', `attachment; filename="cloudfleet-orders-${date}.csv"`);
      response.status(200).send(`\uFEFF${ordersToCsv(orders)}`);
    } catch (error: unknown) { next(error); }
  };
}
