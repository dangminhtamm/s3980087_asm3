import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendCsv, sendData } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type {
  assignDriverSchema,
  createOrderSchema,
  exportOrdersQuerySchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  updateOrderStatusSchema,
  uploadUrlQuerySchema,
} from '../schemas/order.schema.js';
import type { OrderApplicationService } from '../services/order-application.service.js';

type OrderIdParams = z.infer<typeof orderIdParamsSchema>;
type CreateOrderBody = z.infer<typeof createOrderSchema>;
type UpdateStatusBody = z.infer<typeof updateOrderStatusSchema>;
type AssignDriverBody = z.infer<typeof assignDriverSchema>;
type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
type ExportOrdersQuery = z.infer<typeof exportOrdersQuerySchema>;
type UploadUrlQuery = z.infer<typeof uploadUrlQuerySchema>;

export class OrderController {
  public constructor(private readonly orders: OrderApplicationService) {}

  public createOrder = async (request: Request, response: Response): Promise<void> => {
    sendData(
      response,
      201,
      await this.orders.create(
        validated<CreateOrderBody>(response, 'body'),
        request.authenticatedUser!,
      ),
    );
  };

  public updateStatus = async (request: Request, response: Response): Promise<void> => {
    const { id } = validated<OrderIdParams>(response, 'params');
    sendData(
      response,
      200,
      await this.orders.updateStatus(
        id,
        validated<UpdateStatusBody>(response, 'body'),
        request.authenticatedUser!,
      ),
    );
  };

  public listOrders = async (request: Request, response: Response): Promise<void> => {
    sendData(
      response,
      200,
      await this.orders.list(
        validated<ListOrdersQuery>(response, 'query'),
        request.authenticatedUser!,
      ),
    );
  };

  public getOrder = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<OrderIdParams>(response, 'params');
    sendData(response, 200, await this.orders.get(id));
  };

  public getTrackingLink = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<OrderIdParams>(response, 'params');
    sendData(response, 200, await this.orders.getTrackingLink(id));
  };

  public assignDriver = async (request: Request, response: Response): Promise<void> => {
    const { id } = validated<OrderIdParams>(response, 'params');
    const { driverId } = validated<AssignDriverBody>(response, 'body');
    sendData(response, 200, await this.orders.assign(id, driverId, request.authenticatedUser!));
  };

  public getUploadUrl = async (_request: Request, response: Response): Promise<void> => {
    const { orderId, contentType } = validated<UploadUrlQuery>(response, 'query');
    sendData(response, 200, await this.orders.createUploadUrl(orderId, contentType));
  };

  public listEvents = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<OrderIdParams>(response, 'params');
    sendData(response, 200, await this.orders.listEvents(id));
  };

  public importCsv = async (request: Request, response: Response): Promise<void> => {
    const result = await this.orders.importCsv(request.body, request.authenticatedUser!);
    sendData(response, result.failed ? 207 : 201, result);
  };

  public exportCsv = async (_request: Request, response: Response): Promise<void> => {
    const result = await this.orders.exportCsv(validated<ExportOrdersQuery>(response, 'query'));
    sendCsv(response, 200, result.filename, result.content);
  };
}
