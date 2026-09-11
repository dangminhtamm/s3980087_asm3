import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendData } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type {
  createRouteSchema,
  listRoutesQuerySchema,
  reorderRouteSchema,
  reoptimizeRouteSchema,
  routeIdParamsSchema,
} from '../schemas/route.schema.js';
import type { RouteApplicationService } from '../services/route-application.service.js';

type RouteIdParams = z.infer<typeof routeIdParamsSchema>;
type CreateRouteBody = z.infer<typeof createRouteSchema>;
type ListRoutesQuery = z.infer<typeof listRoutesQuerySchema>;
type ReorderRouteBody = z.infer<typeof reorderRouteSchema>;
type ReoptimizeRouteBody = z.infer<typeof reoptimizeRouteSchema>;

export class RouteController {
  public constructor(private readonly routes: RouteApplicationService) {}

  public create = async (request: Request, response: Response): Promise<void> => {
    sendData(
      response,
      201,
      await this.routes.create(
        validated<CreateRouteBody>(response, 'body'),
        request.authenticatedUser!,
      ),
    );
  };

  public get = async (request: Request, response: Response): Promise<void> => {
    const { id } = validated<RouteIdParams>(response, 'params');
    sendData(response, 200, await this.routes.get(id, request.authenticatedUser!));
  };

  public list = async (_request: Request, response: Response): Promise<void> => {
    const { driverId, limit } = validated<ListRoutesQuery>(response, 'query');
    sendData(response, 200, await this.routes.list(driverId, limit));
  };

  public reorder = async (request: Request, response: Response): Promise<void> => {
    const { id } = validated<RouteIdParams>(response, 'params');
    const { orderIds } = validated<ReorderRouteBody>(response, 'body');
    sendData(response, 200, await this.routes.reorder(id, orderIds, request.authenticatedUser!));
  };

  public reoptimize = async (request: Request, response: Response): Promise<void> => {
    const { id } = validated<RouteIdParams>(response, 'params');
    const { departureAt } = validated<ReoptimizeRouteBody>(response, 'body');
    sendData(
      response,
      200,
      await this.routes.reoptimize(id, departureAt, request.authenticatedUser!),
    );
  };
}
