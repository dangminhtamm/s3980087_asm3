import type { CreateRouteInput, Route } from '../domain/entities/route.js';
import type { PushService } from './push.service.js';
import type { RouteService } from './route.service.js';

export class RouteWorkflowService {
  public constructor(
    private readonly routes: RouteService,
    private readonly push: PushService,
  ) {}

  public async create(input: CreateRouteInput, actorId: string): Promise<Route> {
    const route = await this.routes.createRoute(input, actorId);
    await this.push.notifyDriver(route.driverId, {
      title: 'Route ready',
      body: `${route.stopCount} stops are ready for ${route.scheduledDate}.`,
      url: '/driver',
      tag: `route-${route.routeId}`,
    });
    return route;
  }
}
