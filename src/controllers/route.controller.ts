import type { NextFunction, Request, Response } from 'express';

import { createRouteSchema, listRoutesQuerySchema, reorderRouteSchema, reoptimizeRouteSchema, routeIdParamsSchema } from '../schemas/route.schema.js';
import type { RouteService } from '../services/route.service.js';
import { AppError } from '../errors/app-error.js';
import type { PushService } from '../services/push.service.js';

export class RouteController {
  public constructor(private readonly routes: RouteService, private readonly push?: PushService) {}

  public create = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const input = createRouteSchema.parse(request.body);
      const route = await this.routes.createRoute(input, request.authenticatedUser!.username);
      await this.push?.notifyDriver(route.driverId, {
        title: 'Route ready',
        body: `${route.stopCount} stops are ready for ${route.scheduledDate}.`,
        url: '/driver',
        tag: `route-${route.routeId}`,
      });
      response.status(201).json({ data: route });
    } catch (error: unknown) { next(error); }
  };

  public get = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = routeIdParamsSchema.parse(request.params);
      const route = await this.routes.getRoute(id);
      const user = request.authenticatedUser!;
      if (!user.roles.includes('ADMIN') && route.driverId !== user.username) {
        throw new AppError(403, 'You cannot access another driver\'s route', 'FORBIDDEN');
      }
      response.status(200).json({ data: route });
    } catch (error: unknown) { next(error); }
  };

  public list = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const input = listRoutesQuerySchema.parse(request.query);
      response.status(200).json({ data: await this.routes.listRoutes(input.driverId, input.limit) });
    } catch (error: unknown) { next(error); }
  };

  public reorder = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = routeIdParamsSchema.parse(request.params);
      const { orderIds } = reorderRouteSchema.parse(request.body);
      response.status(200).json({ data: await this.routes.reorder(id, orderIds, request.authenticatedUser!.username) });
    } catch (error: unknown) { next(error); }
  };

  public reoptimize = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = routeIdParamsSchema.parse(request.params);
      const { departureAt } = reoptimizeRouteSchema.parse(request.body);
      response.status(200).json({ data: await this.routes.reoptimize(id, departureAt, request.authenticatedUser!.username) });
    } catch (error: unknown) { next(error); }
  };
}
