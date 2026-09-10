import { randomUUID } from 'node:crypto';

import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  ORDER_STATUSES,
  type CreateOrderInput,
  type ListOrdersInput,
  type Order,
  type OrderItem,
  type OrderStatus,
  type UpdateOrderStatusInput,
} from '../domain/entities/order.js';
import { AppError } from '../errors/app-error.js';
import {
  createOrderEventItem,
  type OrderEventType,
} from '../domain/entities/order-event.js';
import {
  allowedOrderTransitions,
  canTransitionOrder,
  isExceptionStatus,
  releasesDriver,
} from '../domain/order-lifecycle.js';
import type { TrackingLink } from '../domain/entities/tracking.js';
import {
  generateTrackingToken,
  hashTrackingToken,
  trackingExpiry,
} from '../utils/tracking-token.js';

const STATUS_EVENTS: Record<UpdateOrderStatusInput['status'], OrderEventType> = {
  IN_PROGRESS: 'DELIVERY_STARTED',
  ARRIVED: 'DRIVER_ARRIVED',
  DELIVERED: 'DELIVERY_COMPLETED',
  DELIVERY_FAILED: 'DELIVERY_FAILED',
  RESCHEDULED: 'DELIVERY_RESCHEDULED',
  CANCELLED: 'ORDER_CANCELLED',
  RETURNING: 'RETURN_STARTED',
  RETURNED: 'ORDER_RETURNED',
};

const buildDriverIndexSortKey = (order: Order): string =>
  `STATUS#${order.status}#CREATED#${order.createdAt}#ORDER#${order.orderId}`;

const buildOrderIndexPartitionKey = (status: OrderStatus): string =>
  `ORDER_STATUS#${status}`;

const buildOrderIndexSortKey = (order: Order): string =>
  `CREATED#${order.createdAt}#ORDER#${order.orderId}`;

const isOrderStatus = (value: unknown): value is OrderStatus =>
  typeof value === 'string' &&
  ORDER_STATUSES.some((status) => status === value);

/** Application logic for creating orders and enforcing status transitions. */
export class OrderService {
  public constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly trackingBaseUrl = process.env.TRACKING_BASE_URL?.trim() || null,
  ) {}

  public async createOrder(input: CreateOrderInput, actorId = 'system'): Promise<Order> {
    const order: Order = {
      orderId: randomUUID(),
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      dropoffAddress: input.dropoffAddress,
      region: input.region,
      lat: input.lat,
      lng: input.lng,
      status: input.driverId ? 'ASSIGNED' : 'PENDING',
      driverId: input.driverId ?? null,
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      exception: null,
      timeWindowStart: input.timeWindowStart ?? null,
      timeWindowEnd: input.timeWindowEnd ?? null,
      packageWeightKg: input.packageWeightKg ?? 0,
      packageVolumeM3: input.packageVolumeM3 ?? 0,
      serviceDurationMinutes: input.serviceDurationMinutes ?? 10,
      routeId: null,
      stopSequence: null,
      startedAt: null,
      arrivedAt: null,
      plannedArrivalAt: null,
      customerRescheduleRequest: null,
    };

    const item: OrderItem = {
      PK: `ORDER#${order.orderId}`,
      SK: 'METADATA',
      GSI2PK: buildOrderIndexPartitionKey(order.status),
      GSI2SK: buildOrderIndexSortKey(order),
      ...order,
    };

    if (order.driverId) await this.assertVehicleCapacity(order.driverId, order);

    // Sparse GSI: unassigned orders are intentionally absent from the driver index.
    if (order.driverId) {
      item.GSI1PK = `DRIVER#${order.driverId}`;
      item.GSI1SK = buildDriverIndexSortKey(order);
    }

    const trackingToken = generateTrackingToken();
    const tokenHash = hashTrackingToken(trackingToken);
    const expiresAt = trackingExpiry();

    try {
      const transactionItems = [
        { Put: { TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
        { Put: { TableName: this.tableName, Item: createOrderEventItem({ orderId: order.orderId, type: 'ORDER_CREATED', occurredAt: order.createdAt, actorId, metadata: {} }) } },
        { Put: { TableName: this.tableName, Item: {
          PK: `ORDER#${order.orderId}`,
          SK: 'TRACKING#TOKEN',
          orderId: order.orderId,
          trackingToken,
          tokenHash,
          expiresAt,
        }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
        { Put: { TableName: this.tableName, Item: {
          PK: `TRACKING#${tokenHash}`,
          SK: 'TOKEN',
          orderId: order.orderId,
          expiresAt,
        }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
        ...(order.driverId ? [
          { Update: {
            TableName: this.tableName,
            Key: { PK: `DRIVER#${order.driverId}`, SK: 'PROFILE' },
            UpdateExpression: 'SET #status = :onDelivery, updatedAt = :updatedAt, GSI2PK = :gsi2pk, GSI2SK = :gsi2sk',
            ConditionExpression: '#status = :available OR #status = :onDelivery',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':available': 'AVAILABLE',
              ':onDelivery': 'ON_DELIVERY',
              ':updatedAt': order.createdAt,
              ':gsi2pk': 'DRIVER_STATUS#ON_DELIVERY',
              ':gsi2sk': `UPDATED#${order.createdAt}#DRIVER#${order.driverId}`,
            },
          } },
          { Put: { TableName: this.tableName, Item: createOrderEventItem({ orderId: order.orderId, type: 'DRIVER_ASSIGNED', occurredAt: order.createdAt, actorId, metadata: { driverId: order.driverId } }) } },
        ] : []),
      ];
      await this.database.send(new TransactWriteCommand({ TransactItems: transactionItems }));
    } catch (error: unknown) {
      if (error instanceof ConditionalCheckFailedException || error instanceof TransactionCanceledException) {
        throw new AppError(409, 'Order already exists', 'ORDER_ALREADY_EXISTS');
      }

      throw error;
    }

    return order;
  }

  /** Admin-only retrieval; the capability token is never part of an Order DTO. */
  public async getTrackingLink(orderId: string): Promise<TrackingLink> {
    if (!this.trackingBaseUrl) {
      throw new AppError(
        503,
        'Customer tracking URL is not configured',
        'TRACKING_NOT_CONFIGURED',
      );
    }
    await this.getOrder(orderId);
    const record = await this.ensureTrackingToken(orderId);
    return {
      url: `${this.trackingBaseUrl.replace(/\/$/, '')}/track/${encodeURIComponent(record.token)}`,
      expiresAt: new Date(record.expiresAt * 1000).toISOString(),
    };
  }

  private async ensureTrackingToken(
    orderId: string,
  ): Promise<{ token: string; expiresAt: number }> {
    const result = await this.database.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: `ORDER#${orderId}`, SK: 'TRACKING#TOKEN' },
      ConsistentRead: true,
    }));
    const token = result.Item?.trackingToken;
    const expiresAt = result.Item?.expiresAt;
    if (
      typeof token === 'string' &&
      typeof expiresAt === 'number' &&
      expiresAt > Math.floor(Date.now() / 1000)
    ) {
      return { token, expiresAt };
    }

    const nextToken = generateTrackingToken();
    const nextHash = hashTrackingToken(nextToken);
    const nextExpiry = trackingExpiry();
    await this.database.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName, Item: {
        PK: `ORDER#${orderId}`,
        SK: 'TRACKING#TOKEN',
        orderId,
        trackingToken: nextToken,
        tokenHash: nextHash,
        expiresAt: nextExpiry,
      } } },
      { Put: { TableName: this.tableName, Item: {
        PK: `TRACKING#${nextHash}`,
        SK: 'TOKEN',
        orderId,
        expiresAt: nextExpiry,
      }, ConditionExpression: 'attribute_not_exists(PK)' } },
    ] }));
    return { token: nextToken, expiresAt: nextExpiry };
  }

  public async updateStatus(
    orderId: string,
    input: UpdateOrderStatusInput,
    actorId = 'system',
  ): Promise<Order> {
    const currentOrder = await this.getOrder(orderId);
    const nextStatus = input.status;

    if (!canTransitionOrder(currentOrder.status, nextStatus)) {
      throw new AppError(
        409,
        `Cannot change order status from ${currentOrder.status} to ${nextStatus}`,
        'INVALID_STATUS_TRANSITION',
        { allowedTransitions: allowedOrderTransitions(currentOrder.status) },
      );
    }

    if (
      ['IN_PROGRESS', 'ARRIVED', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNING', 'RETURNED'].includes(nextStatus) &&
      !currentOrder.driverId
    ) {
      throw new AppError(
        409,
        'Assign a driver before advancing this order',
        'ORDER_DRIVER_REQUIRED',
      );
    }

    if (isExceptionStatus(nextStatus) && !input.reason) {
      throw new AppError(
        400,
        `A reason is required when moving an order to ${nextStatus}`,
        'ORDER_EXCEPTION_REASON_REQUIRED',
      );
    }

    if (nextStatus === 'DELIVERED') {
      await this.assertProofExists(orderId);
    }

    // Ensures legacy orders receive a token before the status stream invokes
    // the Twilio Lambda, which then reads this child record consistently.
    await this.ensureTrackingToken(orderId);

    const updatedAt = new Date().toISOString();
    const nextOrder: Order = {
      ...currentOrder,
      status: nextStatus,
      deliveredAt: nextStatus === 'DELIVERED' ? updatedAt : currentOrder.deliveredAt,
      exception: isExceptionStatus(nextStatus)
        ? {
            reason: input.reason!,
            notes: input.notes ?? null,
            reportedAt: updatedAt,
            reportedBy: actorId,
          }
        : currentOrder.exception,
      startedAt: nextStatus === 'IN_PROGRESS' ? updatedAt : currentOrder.startedAt,
      arrivedAt: nextStatus === 'ARRIVED' ? updatedAt : currentOrder.arrivedAt,
    };
    const orderSet = [
      '#status = :nextStatus',
      'GSI2PK = :gsi2pk',
      ...(currentOrder.driverId && nextStatus !== 'RESCHEDULED'
        ? ['GSI1SK = :gsi1sk']
        : []),
      ...(nextStatus === 'DELIVERED' ? ['deliveredAt = :deliveredAt'] : []),
      ...(nextStatus === 'IN_PROGRESS' ? ['startedAt = :startedAt'] : []),
      ...(nextStatus === 'ARRIVED' ? ['arrivedAt = :arrivedAt'] : []),
      ...(isExceptionStatus(nextStatus) ? ['#exception = :exception'] : []),
    ];
    const orderRemove = nextStatus === 'RESCHEDULED'
      ? ' REMOVE driverId, routeId, stopSequence, plannedArrivalAt, GSI1PK, GSI1SK'
      : '';
    const eventMetadata: Record<string, string> = {
      ...(currentOrder.driverId ? { driverId: currentOrder.driverId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    };
    const transactionItems: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      ...(nextStatus === 'DELIVERED'
        ? [{ ConditionCheck: {
            TableName: this.tableName,
            Key: { PK: `ORDER#${orderId}`, SK: 'PROOF#POD' },
            ConditionExpression: 'attribute_exists(PK)',
          } }]
        : []),
      { Update: {
        TableName: this.tableName,
        Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
        UpdateExpression: `SET ${orderSet.join(', ')}${orderRemove}`,
        ConditionExpression: '#status = :expectedStatus',
        ExpressionAttributeNames: {
          '#status': 'status',
          ...(isExceptionStatus(nextStatus) ? { '#exception': 'exception' } : {}),
        },
        ExpressionAttributeValues: {
          ':nextStatus': nextStatus,
          ':expectedStatus': currentOrder.status,
          ':gsi2pk': buildOrderIndexPartitionKey(nextStatus),
          ...(currentOrder.driverId && nextStatus !== 'RESCHEDULED'
            ? { ':gsi1sk': buildDriverIndexSortKey(nextOrder) }
            : {}),
          ...(nextStatus === 'DELIVERED' ? { ':deliveredAt': updatedAt } : {}),
          ...(nextStatus === 'IN_PROGRESS' ? { ':startedAt': updatedAt } : {}),
          ...(nextStatus === 'ARRIVED' ? { ':arrivedAt': updatedAt } : {}),
          ...(isExceptionStatus(nextStatus) ? { ':exception': nextOrder.exception } : {}),
        },
      } },
      { Put: {
        TableName: this.tableName,
        Item: createOrderEventItem({
          orderId,
          type: STATUS_EVENTS[nextStatus],
          occurredAt: updatedAt,
          actorId,
          metadata: eventMetadata,
        }),
      } },
    ];

    if (currentOrder.routeId && currentOrder.stopSequence) {
      transactionItems.push({ Update: {
        TableName: this.tableName,
        Key: {
          PK: `ROUTE#${currentOrder.routeId}`,
          SK: `STOP#${String(currentOrder.stopSequence).padStart(3, '0')}#ORDER#${orderId}`,
        },
        UpdateExpression: `SET #status = :nextStatus${nextStatus === 'ARRIVED' ? ', actualArrivalAt = :actualArrivalAt' : ''}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':nextStatus': nextStatus, ...(nextStatus === 'ARRIVED' ? { ':actualArrivalAt': updatedAt } : {}) },
      } });
      if (nextStatus === 'IN_PROGRESS') {
        transactionItems.push({ Update: {
          TableName: this.tableName,
          Key: { PK: `ROUTE#${currentOrder.routeId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #status = :inProgress',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':inProgress': 'IN_PROGRESS' },
        } });
      }
    }

    if (nextStatus === 'IN_PROGRESS') {
      transactionItems.push({ Update: {
        TableName: this.tableName,
        Key: { PK: `DRIVER#${currentOrder.driverId}`, SK: 'PROFILE' },
        UpdateExpression: 'SET #status = :onDelivery, updatedAt = :updatedAt, GSI2PK = :driverIndexPk, GSI2SK = :driverIndexSk, activeOrderId = :orderId',
        ConditionExpression: 'attribute_exists(PK) AND (#status = :available OR #status = :onDelivery) AND (attribute_not_exists(activeOrderId) OR activeOrderId = :orderId)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':available': 'AVAILABLE', ':onDelivery': 'ON_DELIVERY', ':updatedAt': updatedAt,
          ':driverIndexPk': 'DRIVER_STATUS#ON_DELIVERY',
          ':driverIndexSk': `UPDATED#${updatedAt}#DRIVER#${currentOrder.driverId}`,
          ':orderId': orderId,
        },
      } });
    }

    if (releasesDriver(nextStatus) && currentOrder.driverId) {
      transactionItems.push({ Update: {
        TableName: this.tableName,
        Key: { PK: `DRIVER#${currentOrder.driverId}`, SK: 'PROFILE' },
        UpdateExpression: `SET #status = :available, updatedAt = :updatedAt, GSI2PK = :driverIndexPk, GSI2SK = :driverIndexSk REMOVE activeOrderId${nextStatus === 'DELIVERED' ? ' ADD completedToday :one' : ''}`,
        ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(activeOrderId) OR activeOrderId = :orderId)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':available': 'AVAILABLE', ':updatedAt': updatedAt,
          ':driverIndexPk': 'DRIVER_STATUS#AVAILABLE',
          ':driverIndexSk': `UPDATED#${updatedAt}#DRIVER#${currentOrder.driverId}`,
          ':orderId': orderId,
          ...(nextStatus === 'DELIVERED' ? { ':one': 1 } : {}),
        },
      } });
    }

    try {
      await this.database.send(new TransactWriteCommand({ TransactItems: transactionItems }));
      return this.getOrder(orderId);
    } catch (error: unknown) {
      if (error instanceof ConditionalCheckFailedException || error instanceof TransactionCanceledException) {
        throw new AppError(
          409,
          'Order status changed concurrently; reload and try again',
          'ORDER_STATUS_CONFLICT',
        );
      }

      throw error;
    }
  }

  public async listOrders(input: ListOrdersInput): Promise<Order[]> {
    if (input.driverId) {
      const result = await this.database.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :driver AND begins_with(GSI1SK, :status)',
          ExpressionAttributeValues: {
            ':driver': `DRIVER#${input.driverId}`,
            ':status': input.status ? `STATUS#${input.status}#` : 'STATUS#',
          },
          ScanIndexForward: false,
          Limit: input.limit,
        }),
      );

      return (result.Items ?? []).map((item) => this.toOrder(item));
    }

    const statuses = input.status ? [input.status] : [...ORDER_STATUSES];
    const results = await Promise.all(
      statuses.map((status) =>
        this.database.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :status',
            ExpressionAttributeValues: {
              ':status': buildOrderIndexPartitionKey(status),
            },
            ScanIndexForward: false,
            Limit: input.limit,
          }),
        ),
      ),
    );

    return results
      .flatMap((result) => result.Items ?? [])
      .map((item) => this.toOrder(item))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit);
  }

  public async assignDriver(orderId: string, driverId: string, actorId = 'system'): Promise<Order> {
    const currentOrder = await this.getOrder(orderId);

    if (!canTransitionOrder(currentOrder.status, 'ASSIGNED')) {
      throw new AppError(
        409,
        'Only pending or rescheduled orders can be assigned',
        'ORDER_ASSIGNMENT_NOT_ALLOWED',
      );
    }
    await this.assertVehicleCapacity(driverId, currentOrder);

    const assignedOrder: Order = { ...currentOrder, driverId, status: 'ASSIGNED', exception: null, routeId: null, stopSequence: null };
    const updatedAt = new Date().toISOString();

    try {
      // Order assignment and the driver's operational status change are atomic.
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
                UpdateExpression:
                  'SET driverId = :driverId, #status = :assigned, GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, GSI2PK = :gsi2pk REMOVE #exception, customerRescheduleRequest',
                ConditionExpression:
                  '(#status = :pending OR #status = :rescheduled) AND (attribute_not_exists(driverId) OR driverId = :unassigned)',
                ExpressionAttributeNames: { '#status': 'status', '#exception': 'exception' },
                ExpressionAttributeValues: {
                  ':driverId': driverId,
                  ':assigned': 'ASSIGNED',
                  ':gsi1pk': `DRIVER#${driverId}`,
                  ':gsi1sk': buildDriverIndexSortKey(assignedOrder),
                  ':gsi2pk': buildOrderIndexPartitionKey('ASSIGNED'),
                  ':pending': 'PENDING',
                  ':rescheduled': 'RESCHEDULED',
                  ':unassigned': null,
                },
              },
            },
            {
              Update: {
                TableName: this.tableName,
                Key: { PK: `DRIVER#${driverId}`, SK: 'PROFILE' },
                UpdateExpression:
                  'SET #status = :onDelivery, updatedAt = :updatedAt, GSI2PK = :gsi2pk, GSI2SK = :gsi2sk',
                ConditionExpression: '#status = :available OR #status = :onDelivery',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                  ':available': 'AVAILABLE',
                  ':onDelivery': 'ON_DELIVERY',
                  ':updatedAt': updatedAt,
                  ':gsi2pk': 'DRIVER_STATUS#ON_DELIVERY',
                  ':gsi2sk': `UPDATED#${updatedAt}#DRIVER#${driverId}`,
                },
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: createOrderEventItem({ orderId, type: 'DRIVER_ASSIGNED', occurredAt: updatedAt, actorId, metadata: { driverId } }),
              },
            },
          ],
        }),
      );
    } catch (error: unknown) {
      if (error instanceof TransactionCanceledException) {
        throw new AppError(
          409,
          'Order or driver availability changed; refresh and try again',
          'ORDER_ASSIGNMENT_CONFLICT',
        );
      }
      throw error;
    }

    return this.getOrder(orderId);
  }

  private async assertVehicleCapacity(driverId: string, nextOrder: Order): Promise<void> {
    const [driverResult, currentOrders] = await Promise.all([
      this.database.send(new GetCommand({
        TableName: this.tableName,
        Key: { PK: `DRIVER#${driverId}`, SK: 'PROFILE' },
        ConsistentRead: true,
      })),
      this.listOrders({ driverId, limit: 100 }),
    ]);
    if (!driverResult.Item) throw new AppError(404, 'Driver not found', 'DRIVER_NOT_FOUND');
    const maxWeightKg = typeof driverResult.Item.maxWeightKg === 'number' ? driverResult.Item.maxWeightKg : 20;
    const maxVolumeM3 = typeof driverResult.Item.maxVolumeM3 === 'number' ? driverResult.Item.maxVolumeM3 : 0.25;
    const active = currentOrders.filter((order) => ['ASSIGNED', 'IN_PROGRESS', 'ARRIVED', 'RETURNING'].includes(order.status));
    const weightKg = active.reduce((sum, order) => sum + order.packageWeightKg, nextOrder.packageWeightKg);
    const volumeM3 = active.reduce((sum, order) => sum + order.packageVolumeM3, nextOrder.packageVolumeM3);
    if (weightKg > maxWeightKg || volumeM3 > maxVolumeM3) {
      throw new AppError(409, 'The assignment exceeds vehicle capacity', 'VEHICLE_CAPACITY_EXCEEDED', {
        requested: { weightKg, volumeM3 }, capacity: { weightKg: maxWeightKg, volumeM3: maxVolumeM3 },
      });
    }
  }

  /** Proof can only be attached while delivery is actively in progress. */
  public async assertCanUploadProof(orderId: string): Promise<void> {
    const order = await this.getOrder(orderId);

    if (order.status !== 'ARRIVED') {
      throw new AppError(
        409,
        'Proof of delivery can only be uploaded after arrival',
        'PROOF_UPLOAD_NOT_ALLOWED',
      );
    }
  }

  public async getOrder(orderId: string): Promise<Order> {
    const result = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      throw new AppError(404, 'Order not found', 'ORDER_NOT_FOUND');
    }

    return this.toOrder(result.Item);
  }

  private async assertProofExists(orderId: string): Promise<void> {
    const result = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `ORDER#${orderId}`, SK: 'PROOF#POD' },
        ConsistentRead: true,
        ProjectionExpression: 'PK',
      }),
    );

    if (!result.Item) {
      throw new AppError(
        409,
        'Upload and register proof of delivery before completing the order',
        'DELIVERY_PROOF_REQUIRED',
      );
    }
  }

  /** Validates data read from DynamoDB before it enters the domain layer. */
  private toOrder(item: Record<string, unknown>): Order {
    const requiredStrings = [
      'orderId',
      'customerName',
      'customerPhone',
      'dropoffAddress',
      'region',
      'createdAt',
    ] as const;

    for (const property of requiredStrings) {
      if (typeof item[property] !== 'string') {
        throw new Error(`Stored order has an invalid ${property}`);
      }
    }

    if (!isOrderStatus(item.status)) {
      throw new Error('Stored order has an invalid status');
    }

    if (
      typeof item.lat !== 'number' ||
      item.lat < -90 ||
      item.lat > 90 ||
      typeof item.lng !== 'number' ||
      item.lng < -180 ||
      item.lng > 180
    ) {
      throw new Error('Stored order has invalid coordinates');
    }

    const driverId = item.driverId ?? null;
    if (driverId !== null && typeof driverId !== 'string') {
      throw new Error('Stored order has an invalid driverId');
    }
    const deliveredAt = item.deliveredAt ?? null;
    if (deliveredAt !== null && typeof deliveredAt !== 'string') {
      throw new Error('Stored order has an invalid deliveredAt');
    }

    const exception = item.exception ?? null;
    if (
      exception !== null &&
      (typeof exception !== 'object' ||
        Array.isArray(exception) ||
        typeof (exception as Record<string, unknown>).reason !== 'string' ||
        typeof (exception as Record<string, unknown>).reportedAt !== 'string' ||
        typeof (exception as Record<string, unknown>).reportedBy !== 'string')
    ) {
      throw new Error('Stored order has invalid exception data');
    }

    const customerRescheduleRequest = item.customerRescheduleRequest ?? null;
    if (
      customerRescheduleRequest !== null &&
      (typeof customerRescheduleRequest !== 'object' ||
        Array.isArray(customerRescheduleRequest) ||
        typeof (customerRescheduleRequest as Record<string, unknown>).requestedWindowStart !== 'string' ||
        typeof (customerRescheduleRequest as Record<string, unknown>).requestedWindowEnd !== 'string' ||
        typeof (customerRescheduleRequest as Record<string, unknown>).requestedAt !== 'string')
    ) throw new Error('Stored order has invalid customer reschedule data');

    const nullableStringFields = ['timeWindowStart', 'timeWindowEnd', 'routeId', 'startedAt', 'arrivedAt', 'plannedArrivalAt'] as const;
    for (const property of nullableStringFields) {
      const value = item[property] ?? null;
      if (value !== null && typeof value !== 'string') throw new Error(`Stored order has an invalid ${property}`);
    }
    const numericDefaults = {
      packageWeightKg: 0,
      packageVolumeM3: 0,
      serviceDurationMinutes: 10,
    } as const;
    for (const [property, fallback] of Object.entries(numericDefaults)) {
      const value = item[property] ?? fallback;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new Error(`Stored order has an invalid ${property}`);
      }
    }
    const stopSequence = item.stopSequence ?? null;
    if (stopSequence !== null && (typeof stopSequence !== 'number' || !Number.isInteger(stopSequence) || stopSequence < 1)) {
      throw new Error('Stored order has an invalid stopSequence');
    }

    return {
      orderId: item.orderId as string,
      customerName: item.customerName as string,
      customerPhone: item.customerPhone as string,
      dropoffAddress: item.dropoffAddress as string,
      region: item.region as string,
      lat: item.lat,
      lng: item.lng,
      status: item.status,
      driverId,
      createdAt: item.createdAt as string,
      deliveredAt,
      exception: exception as Order['exception'],
      timeWindowStart: (item.timeWindowStart ?? null) as string | null,
      timeWindowEnd: (item.timeWindowEnd ?? null) as string | null,
      packageWeightKg: (item.packageWeightKg ?? 0) as number,
      packageVolumeM3: (item.packageVolumeM3 ?? 0) as number,
      serviceDurationMinutes: (item.serviceDurationMinutes ?? 10) as number,
      routeId: (item.routeId ?? null) as string | null,
      stopSequence: stopSequence as number | null,
      startedAt: (item.startedAt ?? null) as string | null,
      arrivedAt: (item.arrivedAt ?? null) as string | null,
      plannedArrivalAt: (item.plannedArrivalAt ?? null) as string | null,
      customerRescheduleRequest: customerRescheduleRequest as Order['customerRescheduleRequest'],
    };
  }
}
