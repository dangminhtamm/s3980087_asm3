import type { CreateRouteInput, Route } from '../domain/entities/route.js';
import type { PushPort } from '../ports/push.port.js';
import type { RouteService } from './route.service.js';

export class RouteWorkflowService {
  public constructor(
    private readonly routes: RouteService,
    private readonly push: PushPort,
  ) {}

  public async create(input: CreateRouteInput, actorId: string): Promise<Route> {
    const route = await this.routes.createRoute(input, actorId);
    void this.push
      .notifyDriver(route.driverId, {
        title: 'Route ready',
        body: `${route.stopCount} stops are ready for ${route.scheduledDate}.`,
        url: '/driver',
        tag: `route-${route.routeId}`,
      })
      .catch((error: unknown) => {
        console.error('Route push dispatch failed', {
          routeId: route.routeId,
          driverId: route.driverId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return route;
  }
}
