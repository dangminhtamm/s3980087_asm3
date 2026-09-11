import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type GetCommandOutput,
  type QueryCommandOutput,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

import { createOrderEvent, type OrderEventType } from '../domain/entities/order-event.js';
import {
  ORDER_STATUSES,
  type ListOrdersInput,
  type Order,
  type OrderItem,
  type UpdateOrderStatusInput,
} from '../domain/entities/order.js';
import { isExceptionStatus, releasesDriver } from '../domain/order-lifecycle.js';
import type { VehicleCapacity } from '../domain/policies/vehicle-capacity.policy.js';
import { AppError } from '../errors/app-error.js';
import { DynamoKeys } from '../infrastructure/dynamodb/dynamo-keys.js';
import { mapOrderItem } from '../infrastructure/dynamodb/mappers/order.mapper.js';
import { mapOrderEventItem } from '../infrastructure/dynamodb/mappers/order-event.mapper.js';
import type { DatabasePort } from '../ports/database.port.js';
import type {
  TrackingTokenRecord,
  TrackingTokenStorePort,
} from '../ports/tracking-token-store.port.js';

const driverCapacitySchema = z.object({
  maxWeightKg: z.number().nonnegative().default(20),
  maxVolumeM3: z.number().nonnegative().default(0.25),
});

export interface PersistStatusChange {
  current: Order;
  next: Order;
  input: UpdateOrderStatusInput;
  actorId: string;
  eventType: OrderEventType;
  updatedAt: string;
}

export class OrderRepository implements TrackingTokenStorePort {
  public constructor(
    private readonly database: DatabasePort,
    private readonly tableName: string,
  ) {}

  public async create(order: Order, actorId: string, tracking: TrackingTokenRecord): Promise<void> {
    const item: OrderItem = {
      ...DynamoKeys.orderMetadata(order.orderId),
      GSI2PK: DynamoKeys.orderStatusPk(order.status),
      GSI2SK: DynamoKeys.orderCreatedSk(order),
      ...order,
    };
    if (order.driverId) {
      item.GSI1PK = DynamoKeys.driverPk(order.driverId);
      item.GSI1SK = DynamoKeys.driverOrderSk(order);
    }

    const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
        Put: {
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: mapOrderEventItem(
            createOrderEvent({
              orderId: order.orderId,
              type: 'ORDER_CREATED',
              occurredAt: order.createdAt,
              actorId,
              metadata: {},
            }),
          ),
        },
      },
      ...this.trackingTokenPuts(order.orderId, tracking, true),
      ...(order.driverId ? this.initialDriverAssignment(order, actorId) : []),
    ];

    try {
      await this.database.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (error: unknown) {
      if (
        error instanceof ConditionalCheckFailedException ||
        error instanceof TransactionCanceledException
      )
        throw new AppError(409, 'Order already exists', 'ORDER_ALREADY_EXISTS');
      throw error;
    }
  }

  public async findById(orderId: string): Promise<Order | null> {
    const result = await this.database.send<GetCommandOutput>(
      new GetCommand({
        TableName: this.tableName,
        Key: DynamoKeys.orderMetadata(orderId),
        ConsistentRead: true,
      }),
    );
    return result.Item ? mapOrderItem(result.Item) : null;
  }

  public async getById(orderId: string): Promise<Order> {
    const order = await this.findById(orderId);
    if (!order) throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
    return order;
  }

  public async list(input: ListOrdersInput): Promise<Order[]> {
    if (input.driverId) return this.listForDriver(input);

    const statuses = input.status ? [input.status] : [...ORDER_STATUSES];
    const results = await Promise.all(
      statuses.map((status) =>
        this.database.send<QueryCommandOutput>(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :status',
            ExpressionAttributeValues: { ':status': DynamoKeys.orderStatusPk(status) },
            ScanIndexForward: false,
            Limit: input.limit,
          }),
        ),
      ),
    );
    return results
      .flatMap((result) => result.Items ?? [])
      .map(mapOrderItem)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit);
  }

  private async listForDriver(input: ListOrdersInput): Promise<Order[]> {
    const result = await this.database.send<QueryCommandOutput>(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :driver AND begins_with(GSI1SK, :status)',
        ExpressionAttributeValues: {
          ':driver': DynamoKeys.driverPk(input.driverId!),
          ':status': input.status ? `STATUS#${input.status}#` : 'STATUS#',
        },
        ScanIndexForward: false,
        Limit: input.limit,
      }),
    );
    return (result.Items ?? []).map(mapOrderItem);
  }

  public async getDriverCapacity(driverId: string): Promise<VehicleCapacity> {
    const result = await this.database.send<GetCommandOutput>(
      new GetCommand({
        TableName: this.tableName,
        Key: DynamoKeys.driverProfile(driverId),
        ConsistentRead: true,
      }),
    );
    if (!result.Item) throw new AppError(404, 'Driver not found', 'DRIVER_NOT_FOUND');
    return driverCapacitySchema.parse(result.Item);
  }

  public async proofExists(orderId: string): Promise<boolean> {
    const result = await this.database.send<GetCommandOutput>(
      new GetCommand({
        TableName: this.tableName,
        Key: DynamoKeys.orderProof(orderId),
        ConsistentRead: true,
        ProjectionExpression: 'PK',
      }),
    );
    return Boolean(result.Item);
  }

  public async findTrackingToken(orderId: string): Promise<TrackingTokenRecord | null> {
    const result = await this.database.send<GetCommandOutput>(
      new GetCommand({
        TableName: this.tableName,
        Key: DynamoKeys.orderTrackingToken(orderId),
        ConsistentRead: true,
      }),
    );
    const parsed = z
      .object({
        trackingToken: z.string(),
        tokenHash: z.string().default(''),
        expiresAt: z.number(),
      })
      .safeParse(result.Item);
    if (!parsed.success) return null;
    return {
      token: parsed.data.trackingToken,
      tokenHash: parsed.data.tokenHash,
      expiresAt: parsed.data.expiresAt,
    };
  }

  public async saveTrackingToken(orderId: string, record: TrackingTokenRecord): Promise<void> {
    await this.database.send(
      new TransactWriteCommand({ TransactItems: this.trackingTokenPuts(orderId, record, false) }),
    );
  }

  public async updateStatus(change: PersistStatusChange): Promise<void> {
    const { current, input } = change;
    const status = input.status;
    const set = [
      '#status = :nextStatus',
      'GSI2PK = :gsi2pk',
      ...(current.driverId && status !== 'RESCHEDULED' ? ['GSI1SK = :gsi1sk'] : []),
      ...(status === 'DELIVERED' ? ['deliveredAt = :deliveredAt'] : []),
      ...(status === 'IN_PROGRESS' ? ['startedAt = :startedAt'] : []),
      ...(status === 'ARRIVED' ? ['arrivedAt = :arrivedAt'] : []),
      ...(isExceptionStatus(status) ? ['#exception = :exception'] : []),
    ];
    const remove =
      status === 'RESCHEDULED'
        ? ' REMOVE driverId, routeId, stopSequence, plannedArrivalAt, GSI1PK, GSI1SK'
        : '';
    const items = this.statusTransaction(change, set, remove);

    try {
      await this.database.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (error: unknown) {
      if (
        error instanceof ConditionalCheckFailedException ||
        error instanceof TransactionCanceledException
      )
        throw new AppError(
          409,
          'Order status changed concurrently; reload and try again',
          'ORDER_STATUS_CONFLICT',
        );
      throw error;
    }
  }

  public async assign(current: Order, driverId: string, actorId: string, updatedAt: string) {
    const assigned = { ...current, driverId, status: 'ASSIGNED' as const, exception: null };
    try {
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: DynamoKeys.orderMetadata(current.orderId),
                UpdateExpression:
                  'SET driverId = :driverId, #status = :assigned, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, GSI2PK = :gsi2pk REMOVE #exception, customerRescheduleRequest',
                ConditionExpression:
                  '(#status = :pending OR #status = :rescheduled) AND (attribute_not_exists(driverId) OR driverId = :unassigned)',
                ExpressionAttributeNames: { '#status': 'status', '#exception': 'exception' },
                ExpressionAttributeValues: {
                  ':driverId': driverId,
                  ':assigned': 'ASSIGNED',
                  ':gsi1pk': DynamoKeys.driverPk(driverId),
                  ':gsi1sk': DynamoKeys.driverOrderSk(assigned),
                  ':gsi2pk': DynamoKeys.orderStatusPk('ASSIGNED'),
                  ':pending': 'PENDING',
                  ':rescheduled': 'RESCHEDULED',
                  ':unassigned': null,
                },
              },
            },
            this.driverAssignmentUpdate(driverId, updatedAt),
            {
              Put: {
                TableName: this.tableName,
                Item: mapOrderEventItem(
                  createOrderEvent({
                    orderId: current.orderId,
                    type: 'DRIVER_ASSIGNED',
                    occurredAt: updatedAt,
                    actorId,
                    metadata: { driverId },
                  }),
                ),
              },
            },
          ],
        }),
      );
    } catch (error: unknown) {
      if (error instanceof TransactionCanceledException)
        throw new AppError(
          409,
          'Order or driver availability changed; refresh and try again',
          'ORDER_ASSIGNMENT_CONFLICT',
        );
      throw error;
    }
  }

  private trackingTokenPuts(
    orderId: string,
    record: TrackingTokenRecord,
    protectOrderRecord: boolean,
  ): NonNullable<TransactWriteCommandInput['TransactItems']> {
    return [
      {
        Put: {
          TableName: this.tableName,
          Item: {
            ...DynamoKeys.orderTrackingToken(orderId),
            orderId,
            trackingToken: record.token,
            tokenHash: record.tokenHash,
            expiresAt: record.expiresAt,
          },
          ...(protectOrderRecord
            ? { ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' }
            : {}),
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: {
            ...DynamoKeys.trackingToken(record.tokenHash),
            orderId,
            expiresAt: record.expiresAt,
          },
          ConditionExpression: protectOrderRecord
            ? 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            : 'attribute_not_exists(PK)',
        },
      },
    ];
  }

  private initialDriverAssignment(
    order: Order,
    actorId: string,
  ): NonNullable<TransactWriteCommandInput['TransactItems']> {
    const driverId = order.driverId!;
    return [
      this.driverAssignmentUpdate(driverId, order.createdAt),
      {
        Put: {
          TableName: this.tableName,
          Item: mapOrderEventItem(
            createOrderEvent({
              orderId: order.orderId,
              type: 'DRIVER_ASSIGNED',
              occurredAt: order.createdAt,
              actorId,
              metadata: { driverId },
            }),
          ),
        },
      },
    ];
  }

  private driverAssignmentUpdate(driverId: string, updatedAt: string) {
    return {
      Update: {
        TableName: this.tableName,
        Key: DynamoKeys.driverProfile(driverId),
        UpdateExpression:
          'SET #status = :onDelivery, updatedAt = :updatedAt, GSI2PK = :gsi2pk, GSI2SK = :gsi2sk',
        ConditionExpression: '#status = :available OR #status = :onDelivery',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':available': 'AVAILABLE',
          ':onDelivery': 'ON_DELIVERY',
          ':updatedAt': updatedAt,
          ':gsi2pk': DynamoKeys.driverStatusPk('ON_DELIVERY'),
          ':gsi2sk': DynamoKeys.driverUpdatedSk(driverId, updatedAt),
        },
      },
    };
  }

  private statusTransaction(
    change: PersistStatusChange,
    set: string[],
    remove: string,
  ): NonNullable<TransactWriteCommandInput['TransactItems']> {
    const { current, next, input, actorId, eventType, updatedAt } = change;
    const status = input.status;
    const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      ...(status === 'DELIVERED'
        ? [
            {
              ConditionCheck: {
                TableName: this.tableName,
                Key: DynamoKeys.orderProof(current.orderId),
                ConditionExpression: 'attribute_exists(PK)',
              },
            },
          ]
        : []),
      {
        Update: {
          TableName: this.tableName,
          Key: DynamoKeys.orderMetadata(current.orderId),
          UpdateExpression: `SET ${set.join(', ')}${remove}`,
          ConditionExpression: '#status = :expectedStatus',
          ExpressionAttributeNames: {
            '#status': 'status',
            ...(isExceptionStatus(status) ? { '#exception': 'exception' } : {}),
          },
          ExpressionAttributeValues: {
            ':nextStatus': status,
            ':expectedStatus': current.status,
            ':gsi2pk': DynamoKeys.orderStatusPk(status),
            ...(current.driverId && status !== 'RESCHEDULED'
              ? { ':gsi1sk': DynamoKeys.driverOrderSk(next) }
              : {}),
            ...(status === 'DELIVERED' ? { ':deliveredAt': updatedAt } : {}),
            ...(status === 'IN_PROGRESS' ? { ':startedAt': updatedAt } : {}),
            ...(status === 'ARRIVED' ? { ':arrivedAt': updatedAt } : {}),
            ...(isExceptionStatus(status) ? { ':exception': next.exception } : {}),
          },
        },
      },
      {
        Put: {
          TableName: this.tableName,
          Item: mapOrderEventItem(
            createOrderEvent({
              orderId: current.orderId,
              type: eventType,
              occurredAt: updatedAt,
              actorId,
              metadata: {
                ...(current.driverId ? { driverId: current.driverId } : {}),
                ...(input.reason ? { reason: input.reason } : {}),
                ...(input.notes ? { notes: input.notes } : {}),
              },
            }),
          ),
        },
      },
    ];
    this.appendRouteStatus(items, current, status, updatedAt);
    this.appendDriverStatus(items, current, status, updatedAt);
    return items;
  }

  private appendRouteStatus(
    items: NonNullable<TransactWriteCommandInput['TransactItems']>,
    order: Order,
    status: UpdateOrderStatusInput['status'],
    updatedAt: string,
  ): void {
    if (!order.routeId || !order.stopSequence) return;
    items.push({
      Update: {
        TableName: this.tableName,
        Key: DynamoKeys.routeStop(order.routeId, order.stopSequence, order.orderId),
        UpdateExpression: `SET #status = :nextStatus${status === 'ARRIVED' ? ', actualArrivalAt = :actualArrivalAt' : ''}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':nextStatus': status,
          ...(status === 'ARRIVED' ? { ':actualArrivalAt': updatedAt } : {}),
        },
      },
    });
    if (status === 'IN_PROGRESS')
      items.push({
        Update: {
          TableName: this.tableName,
          Key: DynamoKeys.routeMetadata(order.routeId),
          UpdateExpression: 'SET #status = :inProgress',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':inProgress': 'IN_PROGRESS' },
        },
      });
  }

  private appendDriverStatus(
    items: NonNullable<TransactWriteCommandInput['TransactItems']>,
    order: Order,
    status: UpdateOrderStatusInput['status'],
    updatedAt: string,
  ): void {
    if (!order.driverId) return;
    if (status === 'IN_PROGRESS') {
      items.push({
        Update: {
          TableName: this.tableName,
          Key: DynamoKeys.driverProfile(order.driverId),
          UpdateExpression:
            'SET #status = :onDelivery, updatedAt = :updatedAt, GSI2PK = :driverIndexPk, GSI2SK = :driverIndexSk, activeOrderId = :orderId',
          ConditionExpression:
            'attribute_exists(PK) AND (#status = :available OR #status = :onDelivery) AND (attribute_not_exists(activeOrderId) OR activeOrderId = :orderId)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':available': 'AVAILABLE',
            ':onDelivery': 'ON_DELIVERY',
            ':updatedAt': updatedAt,
            ':driverIndexPk': DynamoKeys.driverStatusPk('ON_DELIVERY'),
            ':driverIndexSk': DynamoKeys.driverUpdatedSk(order.driverId, updatedAt),
            ':orderId': order.orderId,
          },
        },
      });
    }
    if (releasesDriver(status)) {
      items.push({
        Update: {
          TableName: this.tableName,
          Key: DynamoKeys.driverProfile(order.driverId),
          UpdateExpression: `SET #status = :available, updatedAt = :updatedAt, GSI2PK = :driverIndexPk, GSI2SK = :driverIndexSk REMOVE activeOrderId${status === 'DELIVERED' ? ' ADD completedToday :one' : ''}`,
          ConditionExpression:
            'attribute_exists(PK) AND (attribute_not_exists(activeOrderId) OR activeOrderId = :orderId)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':available': 'AVAILABLE',
            ':updatedAt': updatedAt,
            ':driverIndexPk': DynamoKeys.driverStatusPk('AVAILABLE'),
            ':driverIndexSk': DynamoKeys.driverUpdatedSk(order.driverId, updatedAt),
            ':orderId': order.orderId,
            ...(status === 'DELIVERED' ? { ':one': 1 } : {}),
          },
        },
      });
    }
  }
}
