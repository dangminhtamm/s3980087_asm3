import type { AuthenticatedUser } from '../domain/entities/auth.js';
import type { CreateRouteInput, Route } from '../domain/entities/route.js';
import { AppError } from '../errors/app-error.js';
import type { RouteService } from './route.service.js';
import type { RouteWorkflowService } from './route-workflow.service.js';

export class RouteApplicationService {
  public constructor(
    private readonly routes: RouteService,
    private readonly workflow: RouteWorkflowService,
  ) {}

  public create(input: CreateRouteInput, user: AuthenticatedUser): Promise<Route> {
    return this.workflow.create(input, user.username);
  }

  public async get(routeId: string, user: AuthenticatedUser): Promise<Route> {
    const route = await this.routes.getRoute(routeId);
    if (!user.roles.includes('ADMIN') && route.driverId !== user.username) {
      throw new AppError(403, "You cannot access another driver's route", 'FORBIDDEN');
    }
    return route;
  }

  public list(driverId: string | undefined, limit: number): Promise<Route[]> {
    return this.routes.listRoutes(driverId, limit);
  }

  public reorder(routeId: string, orderIds: string[], user: AuthenticatedUser): Promise<Route> {
    return this.routes.reorder(routeId, orderIds, user.username);
  }

  public reoptimize(
    routeId: string,
    departureAt: string | undefined,
    user: AuthenticatedUser,
  ): Promise<Route> {
    return this.routes.reoptimize(routeId, departureAt, user.username);
  }
}
