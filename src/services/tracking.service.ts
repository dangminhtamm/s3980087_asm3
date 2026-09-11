import {
  GetCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import type {
  CustomerFeedback,
  CustomerRescheduleRequest,
  PublicTrackingResponse,
} from '../domain/entities/tracking.js';
import { AppError } from '../errors/app-error.js';
import { hashTrackingToken } from '../utils/tracking-token.js';
import type { DriverService } from './driver.service.js';
import type { OrderEventService } from './order-event.service.js';
import type { OrderService } from './order.service.js';
import { createOrderEventItem } from '../domain/entities/order-event.js';

const LOCATION_FRESH_MS = 5 * 60 * 1000;
const APPROACHING_DISTANCE_KM = 1.5;
const ASSUMED_CITY_SPEED_KMH = 25;

const toRadians = (value: number): number => (value * Math.PI) / 180;
const haversineKm = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number => {
  const earthRadiusKm = 6371;
  const latitudeDelta = toRadians(to.lat - from.lat);
  const longitudeDelta = toRadians(to.lng - from.lng);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

export class TrackingService {
  public constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly orders: OrderService,
    private readonly events: OrderEventService,
    private readonly drivers: DriverService,
  ) {}

  public async getTracking(token: string): Promise<PublicTrackingResponse> {
    const { orderId, expiresAt, tokenHash } = await this.resolveToken(token);
    const order = await this.orders.getOrder(orderId);
    const [timeline, driverResult, proofResult, feedbackResult] = await Promise.all([
      this.events.list(order),
      order.driverId
        ? this.drivers.getDriver(order.driverId).catch(() => null)
        : Promise.resolve(null),
      this.database.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `ORDER#${orderId}`, SK: 'PROOF#POD' },
          ConsistentRead: true,
          ProjectionExpression: 'uploadedAt, recipientName, signatureDataUrl',
        }),
      ),
      this.database.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { PK: `ORDER#${orderId}`, SK: 'CUSTOMER#FEEDBACK' },
          ConsistentRead: true,
        }),
      ),
    ]);

    const feedback =
      feedbackResult.Item &&
      typeof feedbackResult.Item.rating === 'number' &&
      typeof feedbackResult.Item.submittedAt === 'string'
        ? {
            rating: feedbackResult.Item.rating,
            comment:
              typeof feedbackResult.Item.comment === 'string' ? feedbackResult.Item.comment : null,
            submittedAt: feedbackResult.Item.submittedAt,
          }
        : null;
    const rescheduleRequest = order.customerRescheduleRequest;

    const hasFreshDriverLocation = Boolean(
      driverResult?.lat !== null &&
      driverResult?.lat !== undefined &&
      driverResult.lng !== null &&
      driverResult.locationUpdatedAt &&
      Date.now() - Date.parse(driverResult.locationUpdatedAt) <= LOCATION_FRESH_MS,
    );
    const distanceRemainingKm =
      hasFreshDriverLocation && driverResult
        ? haversineKm(
            { lat: driverResult.lat!, lng: driverResult.lng! },
            { lat: order.lat, lng: order.lng },
          )
        : null;
    const roundedDistance =
      distanceRemainingKm === null ? null : Math.round(distanceRemainingKm * 100) / 100;
    const estimatedArrivalMinutes =
      distanceRemainingKm === null || order.status !== 'IN_PROGRESS'
        ? null
        : Math.max(2, Math.round((distanceRemainingKm / ASSUMED_CITY_SPEED_KMH) * 60));
    const proofUploadedAt = proofResult.Item?.uploadedAt;

    return {
      reference: `CF-${tokenHash.slice(0, 8).toUpperCase()}`,
      status: order.status,
      customerName: order.customerName,
      destination: {
        address: order.dropoffAddress,
        region: order.region,
        lat: order.lat,
        lng: order.lng,
      },
      driver: driverResult
        ? {
            name: driverResult.name,
            vehiclePlate: driverResult.vehiclePlate,
            lat: driverResult.lat,
            lng: driverResult.lng,
            locationUpdatedAt: driverResult.locationUpdatedAt,
          }
        : null,
      distanceRemainingKm: roundedDistance,
      estimatedArrivalMinutes,
      driverApproaching:
        order.status === 'IN_PROGRESS' &&
        distanceRemainingKm !== null &&
        distanceRemainingKm <= APPROACHING_DISTANCE_KM,
      timeline: timeline.map((event) => ({
        type: event.type,
        occurredAt: event.occurredAt,
      })),
      proof: {
        confirmed: typeof proofUploadedAt === 'string',
        uploadedAt: typeof proofUploadedAt === 'string' ? proofUploadedAt : null,
        recipientName:
          typeof proofResult.Item?.recipientName === 'string'
            ? proofResult.Item.recipientName
            : null,
        signatureCaptured: typeof proofResult.Item?.signatureDataUrl === 'string',
      },
      feedback,
      rescheduleRequest,
      createdAt: order.createdAt,
      deliveredAt: order.deliveredAt,
      trackingExpiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  public async submitFeedback(
    token: string,
    input: { rating: number; comment?: string | undefined },
  ): Promise<CustomerFeedback> {
    const { orderId, tokenHash } = await this.resolveToken(token);
    const order = await this.orders.getOrder(orderId);
    if (order.status !== 'DELIVERED')
      throw new AppError(409, 'Feedback is available after delivery', 'FEEDBACK_NOT_AVAILABLE');
    const feedback: CustomerFeedback = {
      rating: input.rating,
      comment: input.comment ?? null,
      submittedAt: new Date().toISOString(),
    };
    try {
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: { PK: `ORDER#${orderId}`, SK: 'CUSTOMER#FEEDBACK', ...feedback },
                ConditionExpression: 'attribute_not_exists(PK)',
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: createOrderEventItem({
                  orderId,
                  type: 'CUSTOMER_FEEDBACK_RECEIVED',
                  occurredAt: feedback.submittedAt,
                  actorId: `customer:${tokenHash.slice(0, 12)}`,
                  metadata: { rating: String(input.rating) },
                }),
              },
            },
          ],
        }),
      );
    } catch (error: unknown) {
      if (error instanceof TransactionCanceledException)
        throw new AppError(409, 'Feedback was already submitted', 'FEEDBACK_ALREADY_SUBMITTED');
      throw error;
    }
    return feedback;
  }

  public async requestReschedule(
    token: string,
    input: { requestedWindowStart: string; requestedWindowEnd: string; notes?: string | undefined },
  ): Promise<CustomerRescheduleRequest> {
    const { orderId, tokenHash } = await this.resolveToken(token);
    const request: CustomerRescheduleRequest = {
      requestedWindowStart: input.requestedWindowStart,
      requestedWindowEnd: input.requestedWindowEnd,
      notes: input.notes ?? null,
      requestedAt: new Date().toISOString(),
    };
    try {
      await this.database.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: this.tableName,
                Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
                UpdateExpression: 'SET customerRescheduleRequest = :request',
                ConditionExpression: '#status = :pending OR #status = :assigned',
                ExpressionAttributeNames: { '#status': 'status' },
                ExpressionAttributeValues: {
                  ':request': request,
                  ':pending': 'PENDING',
                  ':assigned': 'ASSIGNED',
                },
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: createOrderEventItem({
                  orderId,
                  type: 'CUSTOMER_RESCHEDULE_REQUESTED',
                  occurredAt: request.requestedAt,
                  actorId: `customer:${tokenHash.slice(0, 12)}`,
                  metadata: {
                    requestedWindowStart: request.requestedWindowStart,
                    requestedWindowEnd: request.requestedWindowEnd,
                  },
                }),
              },
            },
          ],
        }),
      );
    } catch (error: unknown) {
      if (error instanceof TransactionCanceledException)
        throw new AppError(
          409,
          'This delivery can no longer be rescheduled online',
          'RESCHEDULE_NOT_AVAILABLE',
        );
      throw error;
    }
    return request;
  }

  private async resolveToken(
    token: string,
  ): Promise<{ orderId: string; expiresAt: number; tokenHash: string }> {
    const tokenHash = hashTrackingToken(token);
    const lookup = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `TRACKING#${tokenHash}`, SK: 'TOKEN' },
        ConsistentRead: true,
      }),
    );
    const orderId = lookup.Item?.orderId;
    const expiresAt = lookup.Item?.expiresAt;

    // Keep invalid, unknown and expired tokens indistinguishable to callers.
    if (
      typeof orderId !== 'string' ||
      typeof expiresAt !== 'number' ||
      expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      throw new AppError(
        404,
        'This tracking link is invalid or has expired',
        'TRACKING_LINK_NOT_FOUND',
      );
    }

    return { orderId, expiresAt, tokenHash };
  }
}
