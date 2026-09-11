import { randomUUID } from 'node:crypto';

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  DRIVER_STATUSES,
  type CreateDriverInput,
  type Driver,
  type DriverItem,
  type DriverStatus,
  type DriverLocation,
  type DriverLocationItem,
  type UpdateDriverLocationInput,
} from '../domain/entities/driver.js';
import { AppError } from '../errors/app-error.js';
import { DynamoKeys } from '../infrastructure/dynamodb/dynamo-keys.js';
import type { RealtimeBroadcaster } from './realtime-broadcaster.service.js';

const driverIndexPartitionKey = (status: DriverStatus): string => DynamoKeys.driverStatusPk(status);

const driverIndexSortKey = (driver: Driver): string =>
  DynamoKeys.driverUpdatedSk(driver.driverId, driver.updatedAt);

const isDriverStatus = (value: unknown): value is DriverStatus =>
  typeof value === 'string' && DRIVER_STATUSES.some((status) => status === value);

export class DriverService {
  public constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly realtime?: RealtimeBroadcaster,
  ) {}

  public async createDriver(input: CreateDriverInput): Promise<Driver> {
    const driver: Driver = {
      driverId: `DRV-${randomUUID().slice(0, 8).toUpperCase()}`,
      ...input,
      status: 'AVAILABLE',
      completedToday: 0,
      lat: null,
      lng: null,
      locationUpdatedAt: null,
      updatedAt: new Date().toISOString(),
      maxWeightKg: input.maxWeightKg ?? 20,
      maxVolumeM3: input.maxVolumeM3 ?? 0.25,
    };
    const item: DriverItem = {
      ...DynamoKeys.driverProfile(driver.driverId),
      GSI2PK: driverIndexPartitionKey(driver.status),
      GSI2SK: driverIndexSortKey(driver),
      ...driver,
    };

    await this.database.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );

    return driver;
  }

  public async listDrivers(status: DriverStatus | undefined, limit: number): Promise<Driver[]> {
    const statuses = status ? [status] : [...DRIVER_STATUSES];
    const results = await Promise.all(
      statuses.map((driverStatus) =>
        this.database.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :status',
            ExpressionAttributeValues: {
              ':status': driverIndexPartitionKey(driverStatus),
            },
            ScanIndexForward: false,
            Limit: limit,
          }),
        ),
      ),
    );

    return results
      .flatMap((result) => result.Items ?? [])
      .map((item) => this.toDriver(item))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }

  public async getDriver(driverId: string): Promise<Driver> {
    const result = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: DynamoKeys.driverProfile(driverId),
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      throw new AppError(404, 'Driver not found', 'DRIVER_NOT_FOUND');
    }

    return this.toDriver(result.Item);
  }

  public async updateStatus(driverId: string, status: DriverStatus): Promise<Driver> {
    const current = await this.getDriver(driverId);
    const updatedAt = new Date().toISOString();
    const next = { ...current, status, updatedAt };
    const result = await this.database.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: DynamoKeys.driverProfile(driverId),
        UpdateExpression:
          'SET #status = :status, updatedAt = :updatedAt, GSI2PK = :gsi2pk, GSI2SK = :gsi2sk',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': updatedAt,
          ':gsi2pk': driverIndexPartitionKey(status),
          ':gsi2sk': driverIndexSortKey(next),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );

    if (!result.Attributes) {
      throw new Error('DynamoDB did not return the updated driver');
    }

    return this.toDriver(result.Attributes);
  }

  public async updateLocation(
    driverId: string,
    input: UpdateDriverLocationInput,
  ): Promise<DriverLocation> {
    const current = await this.getDriver(driverId);
    const recordedAt = input.recordedAt ?? new Date().toISOString();
    const location: DriverLocation = {
      driverId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy ?? null,
      recordedAt,
    };
    const historyItem: DriverLocationItem = {
      ...DynamoKeys.driverLocation(driverId, recordedAt, randomUUID()),
      ...location,
      expiresAt: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    };
    const nextDriver: Driver = {
      ...current,
      lat: input.lat,
      lng: input.lng,
      locationUpdatedAt: recordedAt,
      updatedAt: recordedAt,
    };

    await this.database.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: this.tableName,
              Key: DynamoKeys.driverProfile(driverId),
              UpdateExpression:
                'SET lat = :lat, lng = :lng, locationUpdatedAt = :recordedAt, updatedAt = :recordedAt, GSI2SK = :gsi2sk',
              ConditionExpression: 'attribute_exists(PK)',
              ExpressionAttributeValues: {
                ':lat': input.lat,
                ':lng': input.lng,
                ':recordedAt': recordedAt,
                ':gsi2sk': driverIndexSortKey(nextDriver),
              },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: historyItem,
              ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            },
          },
        ],
      }),
    );

    await this.realtime?.publishDriverLocation(location);
    return location;
  }

  private toDriver(item: Record<string, unknown>): Driver {
    const requiredStrings = [
      'driverId',
      'name',
      'phone',
      'vehiclePlate',
      'currentArea',
      'updatedAt',
    ] as const;

    for (const property of requiredStrings) {
      if (typeof item[property] !== 'string') {
        throw new Error(`Stored driver has an invalid ${property}`);
      }
    }

    if (!isDriverStatus(item.status)) {
      throw new Error('Stored driver has an invalid status');
    }
    if (typeof item.completedToday !== 'number') {
      throw new Error('Stored driver has an invalid completedToday');
    }

    const lat = item.lat ?? null;
    const lng = item.lng ?? null;
    const locationUpdatedAt = item.locationUpdatedAt ?? null;
    if (
      (lat !== null && typeof lat !== 'number') ||
      (lng !== null && typeof lng !== 'number') ||
      (locationUpdatedAt !== null && typeof locationUpdatedAt !== 'string')
    ) {
      throw new Error('Stored driver has invalid location data');
    }

    return {
      driverId: item.driverId as string,
      name: item.name as string,
      phone: item.phone as string,
      vehiclePlate: item.vehiclePlate as string,
      currentArea: item.currentArea as string,
      status: item.status,
      completedToday: item.completedToday,
      lat,
      lng,
      locationUpdatedAt,
      updatedAt: item.updatedAt as string,
      maxWeightKg: typeof item.maxWeightKg === 'number' ? item.maxWeightKg : 20,
      maxVolumeM3: typeof item.maxVolumeM3 === 'number' ? item.maxVolumeM3 : 0.25,
    };
  }
}
