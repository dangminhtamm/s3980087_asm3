import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  QueryCommand,
  TransactWriteCommand,
  type QueryCommandOutput,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';

import { createOrderEvent } from '../domain/entities/order-event.js';
import type { Order } from '../domain/entities/order.js';
import type { Route, RouteItem, RouteStopItem } from '../domain/entities/route.js';
import { AppError } from '../errors/app-error.js';
import { DynamoKeys } from '../infrastructure/dynamodb/dynamo-keys.js';
import { mapOrderEventItem } from '../infrastructure/dynamodb/mappers/order-event.mapper.js';
import {
  mapRouteMetadata,
  mapRouteStop,
  type StoredRoute,
  type StoredRouteStop,
} from '../infrastructure/dynamodb/mappers/route.mapper.js';
import type { DatabasePort } from '../ports/database.port.js';
import type { RoutePlan, RoutingPoint } from '../ports/routing.port.js';

export interface StoredRouteAggregate {
  route: StoredRoute;
  stops: StoredRouteStop[];
}

export interface UpdateStoredRoutePlan {
  route: StoredRoute;
  stops: StoredRouteStop[];
  plan: RoutePlan;
  origin: RoutingPoint;
  manual: boolean;
  actorId: string;
  optimizedAt: string;
}

export class RouteRepository {
  public constructor(
    private readonly database: DatabasePort,
    private readonly tableName: string,
  ) {}

  public async create(route: Route, orders: Order[]): Promise<void> {
    const item: RouteItem = {
      ...DynamoKeys.routeMetadata(route.routeId),
      GSI1PK: DynamoKeys.driverPk(route.driverId),
      GSI1SK: DynamoKeys.driverRouteSk(route),
      GSI2PK: DynamoKeys.routeStatusPk('PLANNED'),
      GSI2SK: DynamoKeys.routeStatusSk(route),
      routeId: route.routeId,
      driverId: route.driverId,
      scheduledDate: route.scheduledDate,
      status: route.status,
      stopCount: route.stopCount,
      totalWeightKg: route.totalWeightKg,
      totalVolumeM3: route.totalVolumeM3,
      createdAt: route.createdAt,
      createdBy: route.createdBy,
      origin: route.origin,
      plannedDistanceMeters: route.plannedDistanceMeters,
      plannedDurationSeconds: route.plannedDurationSeconds,
      geometry: route.geometry,
      optimization: route.optimization,
    };
    const orderById = new Map(orders.map((order) => [order.orderId, order]));
    const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [
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
            ...DynamoKeys.routeStop(route.routeId, stop.sequence, stop.orderId),
          } satisfies RouteStopItem,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      })),
      ...route.stops.flatMap((stop) =>
        this.assignOrder(route, stop.sequence, stop.orderId, orderById.get(stop.orderId)!),
      ),
      this.assignDriver(route.driverId, route.createdAt),
    ];

    try {
      await this.database.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (error: unknown) {
      if (error instanceof TransactionCanceledException)
        throw new AppError(
          409,
          'An order or driver changed while the route was being created',
          'ROUTE_ASSIGNMENT_CONFLICT',
        );
      throw error;
    }
  }

  public async load(routeId: string): Promise<StoredRouteAggregate> {
    const result = await this.database.send<QueryCommandOutput>(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': DynamoKeys.routePk(routeId) },
        ConsistentRead: true,
      }),
    );
    const metadata = result.Items?.find((entry) => entry.SK === 'METADATA');
    if (!metadata) throw new AppError(404, 'Route not found', 'ROUTE_NOT_FOUND');
    return {
      route: mapRouteMetadata(metadata),
      stops: (result.Items ?? [])
        .filter(
          (entry) => typeof entry.SK === 'string' && entry.SK.startsWith(DynamoKeys.prefixes.stop),
        )
        .map(mapRouteStop),
    };
  }

  public async list(driverId: string | undefined, limit: number): Promise<StoredRoute[]> {
    if (driverId) {
      const result = await this.database.send<QueryCommandOutput>(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :driver AND begins_with(GSI1SK, :route)',
          ExpressionAttributeValues: {
            ':driver': DynamoKeys.driverPk(driverId),
            ':route': DynamoKeys.prefixes.route,
          },
          ScanIndexForward: false,
          Limit: limit,
        }),
      );
      return (result.Items ?? []).map(mapRouteMetadata);
    }
    const results = await Promise.all(
      ['PLANNED', 'IN_PROGRESS'].map((status) =>
        this.database.send<QueryCommandOutput>(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :status',
            ExpressionAttributeValues: { ':status': DynamoKeys.routeStatusPk(status) },
            ScanIndexForward: false,
            Limit: limit,
          }),
        ),
      ),
    );
    return results
      .flatMap((result) => result.Items ?? [])
      .map(mapRouteMetadata)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  public async updatePlan(input: UpdateStoredRoutePlan): Promise<void> {
    const byOrder = new Map(input.stops.map((stop) => [stop.orderId, stop]));
    const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
        Update: {
          TableName: this.tableName,
          Key: DynamoKeys.routeMetadata(input.route.routeId),
          UpdateExpression:
            'SET origin = :origin, plannedDistanceMeters = :distance, plannedDurationSeconds = :duration, geometry = :geometry, optimization = :optimization',
          ConditionExpression:
            '#status = :planned AND (attribute_not_exists(optimization) OR optimization.revision = :expectedRevision)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':planned': 'PLANNED',
            ':expectedRevision': input.route.optimization.revision,
            ':origin': input.origin,
            ':distance': input.plan.plannedDistanceMeters,
            ':duration': input.plan.plannedDurationSeconds,
            ':geometry': input.plan.geometry,
            ':optimization': {
              provider: input.plan.provider,
              mode: input.manual ? 'MANUAL' : 'AUTO',
              optimizedAt: input.optimizedAt,
              revision: input.route.optimization.revision + 1,
              actorId: input.actorId,
            },
          },
        },
      },
      ...input.plan.stops.flatMap((planned) => {
        const stored = byOrder.get(planned.orderId)!;
        return [
          {
            Update: {
              TableName: this.tableName,
              Key: { PK: DynamoKeys.routePk(input.route.routeId), SK: stored.SK },
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
              Key: DynamoKeys.orderMetadata(planned.orderId),
              UpdateExpression: 'SET stopSequence = :sequence, plannedArrivalAt = :arrival',
              ConditionExpression: 'routeId = :routeId AND #status = :assigned',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':sequence': planned.sequence,
                ':arrival': planned.plannedArrivalAt,
                ':routeId': input.route.routeId,
                ':assigned': 'ASSIGNED',
              },
            },
          },
        ];
      }),
    ];
    try {
      await this.database.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (error: unknown) {
      if (error instanceof TransactionCanceledException)
        throw new AppError(
          409,
          'The route changed while it was being planned',
          'ROUTE_PLAN_CONFLICT',
        );
      throw error;
    }
  }

  private assignOrder(
    route: Route,
    sequence: number,
    orderId: string,
    order: Order,
  ): NonNullable<TransactWriteCommandInput['TransactItems']> {
    const stop = route.stops.find((candidate) => candidate.orderId === orderId)!;
    return [
      {
        Update: {
          TableName: this.tableName,
          Key: DynamoKeys.orderMetadata(orderId),
          UpdateExpression:
            'SET driverId = :driverId, routeId = :routeId, stopSequence = :sequence, plannedArrivalAt = :plannedArrivalAt, #status = :assigned, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, GSI2PK = :gsi2pk REMOVE #exception, customerRescheduleRequest',
          ConditionExpression:
            '(#status = :pending OR #status = :rescheduled) AND (attribute_not_exists(driverId) OR driverId = :unassigned)',
          ExpressionAttributeNames: { '#status': 'status', '#exception': 'exception' },
          ExpressionAttributeValues: {
            ':driverId': route.driverId,
            ':routeId': route.routeId,
            ':sequence': sequence,
            ':plannedArrivalAt': stop.plannedArrivalAt,
            ':assigned': 'ASSIGNED',
            ':pending': 'PENDING',
            ':rescheduled': 'RESCHEDULED',
            ':unassigned': null,
            ':gsi1pk': DynamoKeys.driverPk(route.driverId),
            ':gsi1sk': DynamoKeys.driverOrderSk({ ...order, status: 'ASSIGNED' }),
            ':gsi2pk': DynamoKeys.orderStatusPk('ASSIGNED'),
          },
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: mapOrderEventItem(
            createOrderEvent({
              orderId,
              type: 'DRIVER_ASSIGNED',
              occurredAt: route.createdAt,
              actorId: route.createdBy,
              metadata: {
                driverId: route.driverId,
                routeId: route.routeId,
                stopSequence: String(sequence),
                plannedArrivalAt: stop.plannedArrivalAt,
              },
            }),
          ),
        },
      },
    ];
  }

  private assignDriver(driverId: string, updatedAt: string) {
    return {
      Update: {
        TableName: this.tableName,
        Key: DynamoKeys.driverProfile(driverId),
        UpdateExpression:
          'SET #status = :onDelivery, updatedAt = :updatedAt, GSI2PK = :gsi2pk, GSI2SK = :gsi2sk',
        ConditionExpression: 'attribute_exists(PK) AND #status <> :offline',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':offline': 'OFFLINE',
          ':onDelivery': 'ON_DELIVERY',
          ':updatedAt': updatedAt,
          ':gsi2pk': DynamoKeys.driverStatusPk('ON_DELIVERY'),
          ':gsi2sk': DynamoKeys.driverUpdatedSk(driverId, updatedAt),
        },
      },
    };
  }
}
