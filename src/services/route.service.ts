import { randomUUID } from 'node:crypto';

import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import { createOrderEventItem } from '../domain/entities/order-event.js';
import type { Order } from '../domain/entities/order.js';
import type {
  CreateRouteInput,
  Route,
  RouteComparison,
  RouteItem,
  RouteStop,
  RouteStopItem,
  RouteStatus,
} from '../domain/entities/route.js';
import { AppError } from '../errors/app-error.js';
import type { DriverService } from './driver.service.js';
import type { OrderService } from './order.service.js';
import { RoutingService, type RoutePlanStop } from './routing.service.js';

const routeIndexSortKey = (route: Pick<Route, 'scheduledDate' | 'createdAt' | 'routeId'>): string =>
  `ROUTE#${route.scheduledDate}#CREATED#${route.createdAt}#${route.routeId}`;
const routeStatusIndexSortKey = (
  route: Pick<Route, 'scheduledDate' | 'createdAt' | 'routeId'>,
): string => `DATE#${route.scheduledDate}#CREATED#${route.createdAt}#ROUTE#${route.routeId}`;
const isRouteStatus = (value: unknown): value is RouteStatus =>
  ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(String(value));
const terminalStatuses = new Set(['DELIVERED', 'CANCELLED', 'RETURNED']);
const activeStatuses = new Set(['IN_PROGRESS', 'ARRIVED', 'RETURNING']);

export class RouteService {
  public constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly orders: OrderService,
    private readonly drivers: DriverService,
    private readonly routing = new RoutingService(),
    private readonly defaultOrigin = { lat: 10.7769, lng: 106.7009 },
  ) {}

  public async createRoute(input: CreateRouteInput, actorId: string): Promise<Route> {
    const [driver, selectedOrders, currentLoads] = await Promise.all([
      this.drivers.getDriver(input.driverId),
      Promise.all(input.orderIds.map((orderId) => this.orders.getOrder(orderId))),
      this.orders.listOrders({ driverId: input.driverId, limit: 100 }),
    ]);
    if (driver.status === 'OFFLINE')
      throw new AppError(409, 'An offline driver cannot receive a route', 'DRIVER_OFFLINE');
    const invalid = selectedOrders.find(
      (order) => !['PENDING', 'RESCHEDULED'].includes(order.status) || order.driverId,
    );
    if (invalid)
      throw new AppError(
        409,
        `Order ${invalid.orderId} is no longer available`,
        'ROUTE_ORDER_UNAVAILABLE',
      );
    this.assertCapacity(driver.maxWeightKg, driver.maxVolumeM3, currentLoads, selectedOrders);

    const createdAt = new Date().toISOString();
    const routeId = randomUUID();
    const origin = {
      lat: driver.lat ?? this.defaultOrigin.lat,
      lng: driver.lng ?? this.defaultOrigin.lng,
    };
    const departureAt = `${input.scheduledDate}T01:00:00.000Z`;
    const plan = await this.routing.plan(
      origin,
      selectedOrders,
      departureAt,
      input.optimize === false ? input.orderIds : undefined,
    );
    const plannedByOrder = new Map(plan.stops.map((stop) => [stop.orderId, stop]));
    const route: Route = {
      routeId,
      driverId: input.driverId,
      scheduledDate: input.scheduledDate,
      status: 'PLANNED',
      stopCount: selectedOrders.length,
      totalWeightKg: selectedOrders.reduce((sum, order) => sum + order.packageWeightKg, 0),
      totalVolumeM3: selectedOrders.reduce((sum, order) => sum + order.packageVolumeM3, 0),
      createdAt,
      createdBy: actorId,
      origin,
      plannedDistanceMeters: plan.plannedDistanceMeters,
      plannedDurationSeconds: plan.plannedDurationSeconds,
      geometry: plan.geometry,
      optimization: {
        provider: plan.provider,
        mode: input.optimize === false ? 'MANUAL' : 'AUTO',
        optimizedAt: createdAt,
        revision: 1,
      },
      comparison: this.emptyComparison(plan.plannedDurationSeconds),
      stops: selectedOrders
        .map((order) => this.toStop(routeId, order, plannedByOrder.get(order.orderId)!))
        .sort((a, b) => a.sequence - b.sequence),
    };
    const item: RouteItem = {
      PK: `ROUTE#${routeId}`,
      SK: 'METADATA',
      GSI1PK: `DRIVER#${input.driverId}`,
      GSI1SK: routeIndexSortKey(route),
      GSI2PK: 'ROUTE_STATUS#PLANNED',
      GSI2SK: routeStatusIndexSortKey(route),
      routeId,
      driverId: route.driverId,
      scheduledDate: route.scheduledDate,
      status: route.status,
      stopCount: route.stopCount,
      totalWeightKg: route.totalWeightKg,
      totalVolumeM3: route.totalVolumeM3,
      createdAt,
      createdBy: actorId,
      origin,
      plannedDistanceMeters: route.plannedDistanceMeters,
      plannedDurationSeconds: route.plannedDurationSeconds,
      geometry: route.geometry,
      optimization: route.optimization,
    };
    const orderById = new Map(selectedOrders.map((order) => [order.orderId, order]));
    const transactionItems = [
      {
        Put: {
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      ...route.stops.map((stop) => ({
        Put: {
          TableName: this.tableName,
          Item: {
            ...stop,
            PK: `ROUTE#${routeId}`,
            SK: `STOP#${String(stop.sequence).padStart(3, '0')}#ORDER#${stop.orderId}`,
          } satisfies RouteStopItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      })),
      ...route.stops.flatMap((stop) => {
        const order = orderById.get(stop.orderId)!;
        return [
          {
            Update: {
              TableName: this.tableName,
              Key: { PK: `ORDER#${order.orderId}`, SK: 'METADATA' },
              UpdateExpression:
                'SET driverId = :driverId, routeId = :routeId, stopSequence = :sequence, plannedArrivalAt = :plannedArrivalAt, #status = :assigned, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, GSI2PK = :gsi2pk REMOVE #exception, customerRescheduleRequest',
              ConditionExpression:
                '(#status = :pending OR #status = :rescheduled) AND (attribute_not_exists(driverId) OR driverId = :unassigned)',
              ExpressionAttributeNames: { '#status': 'status', '#exception': 'exception' },
              ExpressionAttributeValues: {
                ':driverId': input.driverId,
                ':routeId': routeId,
                ':sequence': stop.sequence,
                ':plannedArrivalAt': stop.plannedArrivalAt,
                ':assigned': 'ASSIGNED',
                ':pending': 'PENDING',
                ':rescheduled': 'RESCHEDULED',
                ':unassigned': null,
                ':gsi1pk': `DRIVER#${input.driverId}`,
                ':gsi1sk': `STATUS#ASSIGNED#CREATED#${order.createdAt}#ORDER#${order.orderId}`,
                ':gsi2pk': 'ORDER_STATUS#ASSIGNED',
              },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: createOrderEventItem({
                orderId: order.orderId,
                type: 'DRIVER_ASSIGNED',
                occurredAt: createdAt,
                actorId,
                metadata: {
                  driverId: input.driverId,
                  routeId,
                  stopSequence: String(stop.sequence),
                  plannedArrivalAt: stop.plannedArrivalAt,
                },
              }),
            },
          },
        ];
      }),
      {
        Update: {
          TableName: this.tableName,
          Key: { PK: `DRIVER#${input.driverId}`, SK: 'PROFILE' },
          UpdateExpression:
            'SET #status = :onDelivery, updatedAt = :updatedAt, GSI2PK = :gsi2pk, GSI2SK = :gsi2sk',
          ConditionExpression: 'attribute_exists(PK) AND #status <> :offline',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':offline': 'OFFLINE',
            ':onDelivery': 'ON_DELIVERY',
            ':updatedAt': createdAt,
            ':gsi2pk': 'DRIVER_STATUS#ON_DELIVERY',
            ':gsi2sk': `UPDATED#${createdAt}#DRIVER#${input.driverId}`,
          },
        },
      },
    ];
    try {
      await this.database.send(new TransactWriteCommand({ TransactItems: transactionItems }));
    } catch (error: unknown) {
      if (error instanceof TransactionCanceledException)
        throw new AppError(
          409,
          'An order or driver changed while the route was being created',
          'ROUTE_ASSIGNMENT_CONFLICT',
        );
      throw error;
    }
    return route;
  }

  public async getRoute(routeId: string): Promise<Route> {
    const { metadata, storedStops } = await this.loadRouteItems(routeId);
    const liveOrders = await Promise.all(
      storedStops.map((stop) => this.orders.getOrder(String(stop.orderId))),
    );
    const storedByOrder = new Map(storedStops.map((stop) => [String(stop.orderId), stop]));
    const stops = liveOrders
      .map((order) => this.toStop(routeId, order, storedByOrder.get(order.orderId)!))
      .sort((a, b) => a.sequence - b.sequence);
    const storedRoute = this.toRoute(metadata);
    const status: RouteStatus =
      stops.length > 0 && stops.every((stop) => terminalStatuses.has(stop.status))
        ? 'COMPLETED'
        : stops.some((stop) => activeStatuses.has(stop.status))
          ? 'IN_PROGRESS'
          : storedRoute.status;
    return {
      ...storedRoute,
      status,
      comparison: this.comparison(storedRoute.plannedDurationSeconds, liveOrders, stops),
      stops,
    };
  }

  public async listRoutes(driverId: string | undefined, limit: number): Promise<Route[]> {
    if (driverId) {
      const result = await this.database.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :driver AND begins_with(GSI1SK, :route)',
          ExpressionAttributeValues: { ':driver': `DRIVER#${driverId}`, ':route': 'ROUTE#' },
          ScanIndexForward: false,
          Limit: limit,
        }),
      );
      return (result.Items ?? []).map((item) => ({
        ...this.toRoute(item),
        comparison: this.emptyComparison(Number(item.plannedDurationSeconds ?? 0)),
        stops: [],
      }));
    }
    const results = await Promise.all(
      ['PLANNED', 'IN_PROGRESS'].map((status) =>
        this.database.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :status',
            ExpressionAttributeValues: { ':status': `ROUTE_STATUS#${status}` },
            ScanIndexForward: false,
            Limit: limit,
          }),
        ),
      ),
    );
    return results
      .flatMap((result) => result.Items ?? [])
      .map((item) => ({
        ...this.toRoute(item),
        comparison: this.emptyComparison(Number(item.plannedDurationSeconds ?? 0)),
        stops: [],
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  public async reorder(routeId: string, orderIds: string[], actorId: string): Promise<Route> {
    return this.updatePlan(routeId, orderIds, actorId);
  }

  public async reoptimize(
    routeId: string,
    departureAt: string | undefined,
    actorId: string,
  ): Promise<Route> {
    return this.updatePlan(routeId, undefined, actorId, departureAt);
  }

  private async updatePlan(
    routeId: string,
    manualOrderIds: string[] | undefined,
    actorId: string,
    departureOverride?: string,
  ): Promise<Route> {
    const { metadata, storedStops } = await this.loadRouteItems(routeId);
    const route = this.toRoute(metadata);
    if (route.status !== 'PLANNED')
      throw new AppError(409, 'Only a planned route can be reordered', 'ROUTE_REORDER_NOT_ALLOWED');
    const liveOrders = await Promise.all(
      storedStops.map((stop) => this.orders.getOrder(String(stop.orderId))),
    );
    if (
      manualOrderIds &&
      (manualOrderIds.length !== liveOrders.length ||
        new Set(manualOrderIds).size !== liveOrders.length ||
        manualOrderIds.some((id) => !liveOrders.some((order) => order.orderId === id)))
    ) {
      throw new AppError(
        400,
        'orderIds must contain every route stop exactly once',
        'ROUTE_STOP_SET_MISMATCH',
      );
    }
    const driver = await this.drivers.getDriver(route.driverId);
    const origin =
      driver.lat !== null && driver.lng !== null
        ? { lat: driver.lat, lng: driver.lng }
        : route.origin;
    const optimizedAt = new Date().toISOString();
    const plan = await this.routing.plan(
      origin,
      liveOrders,
      departureOverride ?? optimizedAt,
      manualOrderIds,
    );
    const storedByOrder = new Map(storedStops.map((stop) => [String(stop.orderId), stop]));
    const transactionItems = [
      {
        Update: {
          TableName: this.tableName,
          Key: { PK: `ROUTE#${routeId}`, SK: 'METADATA' },
          UpdateExpression:
            'SET origin = :origin, plannedDistanceMeters = :distance, plannedDurationSeconds = :duration, geometry = :geometry, optimization = :optimization',
          ConditionExpression:
            '#status = :planned AND (attribute_not_exists(optimization) OR optimization.revision = :expectedRevision)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':planned': 'PLANNED',
            ':expectedRevision': route.optimization.revision,
            ':origin': origin,
            ':distance': plan.plannedDistanceMeters,
            ':duration': plan.plannedDurationSeconds,
            ':geometry': plan.geometry,
            ':optimization': {
              provider: plan.provider,
              mode: manualOrderIds ? 'MANUAL' : 'AUTO',
              optimizedAt,
              revision: route.optimization.revision + 1,
              actorId,
            },
          },
        },
      },
      ...plan.stops.flatMap((planned) => {
        const stored = storedByOrder.get(planned.orderId)!;
        return [
          {
            Update: {
              TableName: this.tableName,
              Key: { PK: `ROUTE#${routeId}`, SK: stored.SK },
              UpdateExpression:
                'SET #sequence = :sequence, plannedArrivalAt = :arrival, plannedDepartureAt = :departure, plannedTravelDurationSeconds = :travel, plannedDistanceMeters = :distance',
              ExpressionAttributeNames: { '#sequence': 'sequence' },
              ExpressionAttributeValues: {
                ':sequence': planned.sequence,
                ':arrival': planned.plannedArrivalAt,
                ':departure': planned.plannedDepartureAt,
                ':travel': planned.plannedTravelDurationSeconds,
                ':distance': planned.plannedDistanceMeters,
              },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: { PK: `ORDER#${planned.orderId}`, SK: 'METADATA' },
              UpdateExpression: 'SET stopSequence = :sequence, plannedArrivalAt = :arrival',
              ConditionExpression: 'routeId = :routeId AND #status = :assigned',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':sequence': planned.sequence,
                ':arrival': planned.plannedArrivalAt,
                ':routeId': routeId,
                ':assigned': 'ASSIGNED',
              },
            },
          },
        ];
      }),
    ];
    try {
      await this.database.send(new TransactWriteCommand({ TransactItems: transactionItems }));
    } catch (error: unknown) {
      if (error instanceof TransactionCanceledException)
        throw new AppError(
          409,
          'The route changed while it was being planned',
          'ROUTE_PLAN_CONFLICT',
        );
      throw error;
    }
    return this.getRoute(routeId);
  }

  private async loadRouteItems(
    routeId: string,
  ): Promise<{ metadata: Record<string, unknown>; storedStops: Array<Record<string, unknown>> }> {
    const result = await this.database.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `ROUTE#${routeId}` },
        ConsistentRead: true,
      }),
    );
    const metadata = result.Items?.find((entry) => entry.SK === 'METADATA');
    if (!metadata) throw new AppError(404, 'Route not found', 'ROUTE_NOT_FOUND');
    return {
      metadata,
      storedStops: (result.Items ?? []).filter(
        (entry) => typeof entry.SK === 'string' && entry.SK.startsWith('STOP#'),
      ),
    };
  }

  private assertCapacity(
    maxWeightKg: number,
    maxVolumeM3: number,
    current: Order[],
    selected: Order[],
  ): void {
    const existing = current.filter((order) =>
      ['ASSIGNED', 'IN_PROGRESS', 'ARRIVED', 'RETURNING'].includes(order.status),
    );
    const weightKg = [...existing, ...selected].reduce(
      (sum, order) => sum + order.packageWeightKg,
      0,
    );
    const volumeM3 = [...existing, ...selected].reduce(
      (sum, order) => sum + order.packageVolumeM3,
      0,
    );
    if (weightKg > maxWeightKg || volumeM3 > maxVolumeM3)
      throw new AppError(409, 'The route exceeds vehicle capacity', 'VEHICLE_CAPACITY_EXCEEDED', {
        requested: { weightKg, volumeM3 },
        capacity: { weightKg: maxWeightKg, volumeM3: maxVolumeM3 },
      });
  }

  private toStop(
    routeId: string,
    order: Order,
    plan: RoutePlanStop | Record<string, unknown>,
  ): RouteStop {
    const rawPlannedArrival = plan.plannedArrivalAt;
    const plannedArrivalAt =
      typeof rawPlannedArrival === 'string' && Number.isFinite(Date.parse(rawPlannedArrival))
        ? rawPlannedArrival
        : (order.plannedArrivalAt ?? order.createdAt);
    const rawPlannedDeparture = plan.plannedDepartureAt;
    const plannedDepartureAt =
      typeof rawPlannedDeparture === 'string' && Number.isFinite(Date.parse(rawPlannedDeparture))
        ? rawPlannedDeparture
        : new Date(
            Date.parse(plannedArrivalAt) + order.serviceDurationMinutes * 60_000,
          ).toISOString();
    const actualArrivalAt = order.arrivedAt;
    const etaAt = actualArrivalAt ?? plannedArrivalAt;
    const windowEnd = order.timeWindowEnd ? Date.parse(order.timeWindowEnd) : null;
    const reference = actualArrivalAt
      ? Date.parse(actualArrivalAt)
      : Date.now() > Date.parse(plannedArrivalAt)
        ? Date.now()
        : Date.parse(plannedArrivalAt);
    const slaStatus: RouteStop['slaStatus'] = !windowEnd
      ? 'NO_WINDOW'
      : actualArrivalAt
        ? reference <= windowEnd
          ? 'ON_TIME'
          : 'LATE'
        : Date.now() > windowEnd
          ? 'LATE'
          : Date.parse(plannedArrivalAt) > windowEnd
            ? 'AT_RISK'
            : 'ON_TIME';
    return {
      routeId,
      orderId: order.orderId,
      sequence: Number(plan.sequence),
      status: order.status,
      dropoffAddress: order.dropoffAddress,
      lat: order.lat,
      lng: order.lng,
      timeWindowStart: order.timeWindowStart,
      timeWindowEnd: order.timeWindowEnd,
      packageWeightKg: order.packageWeightKg,
      packageVolumeM3: order.packageVolumeM3,
      serviceDurationMinutes: order.serviceDurationMinutes,
      plannedArrivalAt,
      plannedDepartureAt,
      plannedTravelDurationSeconds: Number(plan.plannedTravelDurationSeconds ?? 0),
      plannedDistanceMeters: Number(plan.plannedDistanceMeters ?? 0),
      actualArrivalAt,
      etaAt,
      delayMinutes: Math.round((reference - Date.parse(plannedArrivalAt)) / 60_000),
      slaStatus,
    };
  }

  private toRoute(item: Record<string, unknown>): Omit<Route, 'stops' | 'comparison'> {
    if (!isRouteStatus(item.status)) throw new Error('Stored route has an invalid status');
    const origin = item.origin as { lat?: unknown; lng?: unknown } | undefined;
    const optimization = item.optimization as Route['optimization'] | undefined;
    return {
      routeId: String(item.routeId),
      driverId: String(item.driverId),
      scheduledDate: String(item.scheduledDate),
      status: item.status,
      stopCount: Number(item.stopCount),
      totalWeightKg: Number(item.totalWeightKg),
      totalVolumeM3: Number(item.totalVolumeM3),
      createdAt: String(item.createdAt),
      createdBy: String(item.createdBy),
      origin: { lat: Number(origin?.lat ?? 10.7769), lng: Number(origin?.lng ?? 106.7009) },
      plannedDistanceMeters: Number(item.plannedDistanceMeters ?? 0),
      plannedDurationSeconds: Number(item.plannedDurationSeconds ?? 0),
      geometry: Array.isArray(item.geometry) ? (item.geometry as Array<[number, number]>) : [],
      optimization: optimization ?? {
        provider: 'legacy',
        mode: 'MANUAL',
        optimizedAt: String(item.createdAt),
        revision: 1,
      },
    };
  }

  private emptyComparison(plannedDurationSeconds: number): RouteComparison {
    return {
      plannedDurationSeconds,
      actualDurationSeconds: null,
      varianceSeconds: null,
      completedStops: 0,
      onTimeStops: 0,
      lateStops: 0,
    };
  }

  private comparison(
    plannedDurationSeconds: number,
    orders: Order[],
    stops: RouteStop[],
  ): RouteComparison {
    const starts = orders
      .map((order) => order.startedAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    const ends = orders
      .map((order) => order.arrivedAt ?? order.deliveredAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    const finalEnd = ends.at(-1);
    const actualDurationSeconds = starts[0]
      ? Math.round(
          ((orders.every((order) => terminalStatuses.has(order.status)) && finalEnd
            ? Date.parse(finalEnd)
            : Date.now()) -
            Date.parse(starts[0])) /
            1000,
        )
      : null;
    return {
      plannedDurationSeconds,
      actualDurationSeconds,
      varianceSeconds:
        actualDurationSeconds === null ? null : actualDurationSeconds - plannedDurationSeconds,
      completedStops: orders.filter((order) => terminalStatuses.has(order.status)).length,
      onTimeStops: stops.filter((stop) => stop.actualArrivalAt && stop.slaStatus === 'ON_TIME')
        .length,
      lateStops: stops.filter((stop) => stop.slaStatus === 'LATE').length,
    };
  }
}
