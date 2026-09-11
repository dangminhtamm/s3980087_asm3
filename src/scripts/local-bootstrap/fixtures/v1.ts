import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoKeys } from '../../../infrastructure/dynamodb/dynamo-keys.js';
import type { LocalBootstrapContext } from '../config.js';
import { isNamedError } from '../resource-setup.js';

export const LOCAL_FIXTURE_VERSION = '2026-09-12-v1';

const drivers = [
  {
    driverId: 'DRV-018',
    name: 'Minh Duy',
    phone: '+84901110018',
    vehiclePlate: '51A-482.17',
    currentArea: 'District 1',
    status: 'ON_DELIVERY',
    completedToday: 8,
    lat: 10.7738,
    lng: 106.7018,
    activeOrderId: '0fe1212c-930a-47af-93a7-480ca0a3e771',
    locationUpdatedAt: '2026-08-24T03:12:00.000Z',
    updatedAt: '2026-08-24T03:12:00.000Z',
  },
  {
    driverId: 'DRV-026',
    name: 'Hải Nam',
    phone: '+84901110026',
    vehiclePlate: '59C-318.42',
    currentArea: 'Thu Duc',
    status: 'ON_DELIVERY',
    completedToday: 6,
    lat: 10.7881,
    lng: 106.7461,
    locationUpdatedAt: '2026-08-24T03:08:00.000Z',
    updatedAt: '2026-08-24T03:08:00.000Z',
  },
  {
    driverId: 'DRV-011',
    name: 'Thanh An',
    phone: '+84901110011',
    vehiclePlate: '50H-921.06',
    currentArea: 'District 7',
    status: 'AVAILABLE',
    completedToday: 7,
    lat: 10.7398,
    lng: 106.7122,
    locationUpdatedAt: '2026-08-24T03:02:00.000Z',
    updatedAt: '2026-08-24T03:02:00.000Z',
  },
  {
    driverId: 'DRV-032',
    name: 'Hoàng Sơn',
    phone: '+84901110032',
    vehiclePlate: '51D-104.38',
    currentArea: 'Binh Thanh',
    status: 'OFFLINE',
    completedToday: 0,
    lat: null,
    lng: null,
    locationUpdatedAt: null,
    updatedAt: '2026-08-24T01:14:00.000Z',
  },
] as const;

const orders = [
  {
    orderId: '0fe1212c-930a-47af-93a7-480ca0a3e771',
    customerName: 'Nguyễn Minh Anh',
    customerPhone: '+84901234567',
    dropoffAddress: '72 Nguyen Hue Street, District 1, Ho Chi Minh City',
    region: 'District 1',
    lat: 10.77428,
    lng: 106.70391,
    status: 'IN_PROGRESS',
    driverId: 'DRV-018',
    createdAt: '2026-08-24T02:45:00.000Z',
    deliveredAt: null,
  },
  {
    orderId: '0c8e3c60-05b1-46de-a947-79aa26e67075',
    customerName: 'Trần Lan Anh',
    customerPhone: '+84912345678',
    dropoffAddress: '15 Vo Van Tan Street, District 3, Ho Chi Minh City',
    region: 'District 3',
    lat: 10.77712,
    lng: 106.68842,
    status: 'PENDING',
    driverId: null,
    createdAt: '2026-08-24T03:20:00.000Z',
    deliveredAt: null,
  },
  {
    orderId: 'edccbd70-71f7-4b05-b2b5-dab54fb596d4',
    customerName: 'Lê Khánh Linh',
    customerPhone: '+84923456789',
    dropoffAddress: '82 Dien Bien Phu Street, Binh Thanh District, Ho Chi Minh City',
    region: 'Binh Thanh',
    lat: 10.80122,
    lng: 106.71014,
    status: 'PENDING',
    driverId: null,
    createdAt: '2026-08-24T03:10:00.000Z',
    deliveredAt: null,
  },
  {
    orderId: '20dcfe10-c53c-4d87-b521-23b75ceaff71',
    customerName: 'Phạm Tuấn Kiệt',
    customerPhone: '+84934567890',
    dropoffAddress: '21 Mai Chi Tho Street, Thu Duc City, Ho Chi Minh City',
    region: 'Thu Duc',
    lat: 10.78752,
    lng: 106.74915,
    status: 'ASSIGNED',
    driverId: 'DRV-026',
    createdAt: '2026-08-24T02:55:00.000Z',
    deliveredAt: null,
  },
  {
    orderId: 'f2d6e07d-a558-4026-9f2d-6fa637e097d3',
    customerName: 'Đỗ Bảo Ngọc',
    customerPhone: '+84945678901',
    dropoffAddress: '119 Lam Van Ben Street, District 7, Ho Chi Minh City',
    region: 'District 7',
    lat: 10.7391,
    lng: 106.7131,
    status: 'DELIVERED',
    driverId: 'DRV-011',
    createdAt: '2026-08-24T01:32:00.000Z',
    deliveredAt: '2026-08-24T02:06:00.000Z',
  },
  {
    orderId: '62fcb4ad-1079-437b-a837-87dd2a7ea113',
    customerName: 'Vũ Quốc Bảo',
    customerPhone: '+84956789012',
    dropoffAddress: '82 Nguyen Van Troi Street, Phu Nhuan District, Ho Chi Minh City',
    region: 'Phu Nhuan',
    lat: 10.7962,
    lng: 106.6732,
    status: 'DELIVERED',
    driverId: 'DRV-018',
    createdAt: '2026-08-24T01:10:00.000Z',
    deliveredAt: '2026-08-24T01:48:00.000Z',
  },
  {
    orderId: 'b5a314f0-bba4-4eaf-b88b-cdb4479632fb',
    customerName: 'Mai Thu Hà',
    customerPhone: '+84967890123',
    dropoffAddress: '2 Le Duan Boulevard, District 1, Ho Chi Minh City',
    region: 'District 1',
    lat: 10.78191,
    lng: 106.69925,
    status: 'ASSIGNED',
    driverId: 'DRV-018',
    createdAt: '2026-09-10T00:45:00.000Z',
    deliveredAt: null,
  },
] as const;

const putOnce = async (
  context: LocalBootstrapContext,
  item: Record<string, unknown>,
): Promise<void> => {
  try {
    await context.documentClient.send(
      new PutCommand({
        TableName: context.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
      }),
    );
  } catch (error: unknown) {
    if (!isNamedError(error, ['ConditionalCheckFailedException'])) throw error;
  }
};

const addMinutes = (value: string, minutes: number): string =>
  new Date(new Date(value).getTime() + minutes * 60_000).toISOString();

const seedEvent = (
  orderId: string,
  type: string,
  occurredAt: string,
  actorId: string,
  metadata: Record<string, string> = {},
): Record<string, unknown> => {
  const eventId = `seed-${type.toLowerCase()}`;
  return {
    PK: DynamoKeys.orderPk(orderId),
    SK: DynamoKeys.orderEventSk(occurredAt, eventId),
    eventId,
    orderId,
    type,
    occurredAt,
    actorId,
    source: 'RECORDED',
    metadata,
  };
};

const ensureActiveOrderLock = async (
  context: LocalBootstrapContext,
  orderId: string,
  driverId: string,
): Promise<void> => {
  try {
    await context.documentClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: {
              TableName: context.tableName,
              Key: DynamoKeys.orderMetadata(orderId),
              ConditionExpression: '#status = :inProgress',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: { ':inProgress': 'IN_PROGRESS' },
            },
          },
          {
            Update: {
              TableName: context.tableName,
              Key: DynamoKeys.driverProfile(driverId),
              UpdateExpression: 'SET activeOrderId = if_not_exists(activeOrderId, :orderId)',
              ConditionExpression:
                'attribute_exists(PK) AND (attribute_not_exists(activeOrderId) OR activeOrderId = :orderId)',
              ExpressionAttributeValues: { ':orderId': orderId },
            },
          },
        ],
      }),
    );
  } catch (error: unknown) {
    if (!isNamedError(error, ['TransactionCanceledException'])) throw error;
  }
};

const hourlyVolume = (orderCount: number, seed: number) => {
  const weights = [
    0.2, 0.1, 0.1, 0.1, 0.1, 0.2, 0.6, 1.2, 2.8, 4.8, 5.6, 5.1, 4.4, 4.7, 5.4, 6.2, 7.1, 6.8, 5.1,
    3.4, 2.2, 1.3, 0.7, 0.4,
  ];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const values = weights.map((weight) => Math.floor((orderCount * weight) / totalWeight));
  let remainder = orderCount - values.reduce((sum, value) => sum + value, 0);
  let cursor = seed % 24;
  while (remainder > 0) {
    values[cursor] = (values[cursor] ?? 0) + 1;
    cursor = (cursor + 5) % 24;
    remainder -= 1;
  }
  return values.map((value, hour) => ({ hour, orderCount: value ?? 0 }));
};

const analyticsSnapshot = () => {
  const generatedAt = new Date();
  const coverageTo = new Date(generatedAt);
  coverageTo.setUTCHours(0, 0, 0, 0);
  const profiles = [
    { region: 'District 1', baseVolume: 22, successRate: 0.974, averageMinutes: 29 },
    { region: 'District 3', baseVolume: 18, successRate: 0.962, averageMinutes: 33 },
    { region: 'Binh Thanh', baseVolume: 21, successRate: 0.948, averageMinutes: 39 },
    { region: 'District 7', baseVolume: 17, successRate: 0.969, averageMinutes: 36 },
    { region: 'Thu Duc', baseVolume: 24, successRate: 0.886, averageMinutes: 52 },
  ];
  const daily = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(coverageTo.getTime() - (119 - index) * 86_400_000);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 0.78 : 1;
    const regions = profiles.map((profile, regionIndex) => {
      const orderCount = Math.max(
        3,
        Math.round(
          profile.baseVolume *
            weekend *
            (0.86 + index * 0.0024) *
            (1 + Math.sin(index * 0.61 + regionIndex) * 0.13),
        ),
      );
      const deliveredOrders = Math.min(
        orderCount,
        Math.round(
          orderCount * (profile.successRate + Math.sin(index * 0.27 + regionIndex) * 0.012),
        ),
      );
      const averageMinutes = Math.max(
        12,
        profile.averageMinutes + Math.sin(index * 0.43 + regionIndex) * 4,
      );
      return {
        region: profile.region,
        orderCount,
        deliveredOrders,
        totalDeliveryMinutes: Math.round(deliveredOrders * averageMinutes * 100) / 100,
        deliveryDurationCount: deliveredOrders,
        hourlyOrderVolume: hourlyVolume(orderCount, index + regionIndex * 3),
      };
    });
    return {
      date: date.toISOString().slice(0, 10),
      totalOrders: regions.reduce((sum, region) => sum + region.orderCount, 0),
      deliveredOrders: regions.reduce((sum, region) => sum + region.deliveredOrders, 0),
      totalDeliveryMinutes:
        Math.round(regions.reduce((sum, region) => sum + region.totalDeliveryMinutes, 0) * 100) /
        100,
      deliveryDurationCount: regions.reduce((sum, region) => sum + region.deliveryDurationCount, 0),
      hourlyOrderVolume: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        orderCount: regions.reduce(
          (sum, region) => sum + (region.hourlyOrderVolume[hour]?.orderCount ?? 0),
          0,
        ),
      })),
      regions,
    };
  });
  return {
    schemaVersion: 2,
    fixtureVersion: LOCAL_FIXTURE_VERSION,
    generatedAt: generatedAt.toISOString(),
    coverage: { from: daily[0]!.date, to: daily.at(-1)!.date },
    daily,
  };
};

export const seedLocalFixturesV1 = async (context: LocalBootstrapContext): Promise<void> => {
  await Promise.all(
    drivers.map((driver) =>
      putOnce(context, {
        ...DynamoKeys.driverProfile(driver.driverId),
        GSI2PK: DynamoKeys.driverStatusPk(driver.status),
        GSI2SK: DynamoKeys.driverUpdatedSk(driver.driverId, driver.updatedAt),
        maxWeightKg: 100,
        maxVolumeM3: 1,
        ...driver,
      }),
    ),
  );
  await Promise.all(
    orders.map((order) =>
      putOnce(context, {
        ...DynamoKeys.orderMetadata(order.orderId),
        GSI2PK: DynamoKeys.orderStatusPk(order.status),
        GSI2SK: DynamoKeys.orderCreatedSk(order),
        ...(order.driverId
          ? { GSI1PK: DynamoKeys.driverPk(order.driverId), GSI1SK: DynamoKeys.driverOrderSk(order) }
          : {}),
        exception: null,
        timeWindowStart: null,
        timeWindowEnd: null,
        packageWeightKg: 0,
        packageVolumeM3: 0,
        serviceDurationMinutes: 10,
        routeId: null,
        stopSequence: null,
        startedAt: null,
        arrivedAt: null,
        plannedArrivalAt: null,
        customerRescheduleRequest: null,
        ...order,
      }),
    ),
  );
  await Promise.all(
    orders
      .filter((order) => order.status === 'IN_PROGRESS' && order.driverId)
      .map((order) => ensureActiveOrderLock(context, order.orderId, order.driverId!)),
  );

  const events = orders.flatMap((order) => {
    const result = [seedEvent(order.orderId, 'ORDER_CREATED', order.createdAt, 'local-admin')];
    if (order.driverId) {
      result.push(
        seedEvent(order.orderId, 'DRIVER_ASSIGNED', addMinutes(order.createdAt, 5), 'local-admin', {
          driverId: order.driverId,
        }),
      );
    }
    if (order.status === 'IN_PROGRESS' || order.status === 'DELIVERED') {
      result.push(
        seedEvent(
          order.orderId,
          'DELIVERY_STARTED',
          addMinutes(order.createdAt, 10),
          order.driverId ?? 'local-admin',
        ),
      );
    }
    if (order.status === 'DELIVERED' && order.deliveredAt) {
      result.push(
        seedEvent(
          order.orderId,
          'PROOF_UPLOADED',
          addMinutes(order.deliveredAt, -2),
          order.driverId ?? 'local-driver',
        ),
        seedEvent(
          order.orderId,
          'DELIVERY_COMPLETED',
          order.deliveredAt,
          order.driverId ?? 'local-driver',
        ),
        seedEvent(
          order.orderId,
          'SMS_NOTIFICATION_SENT',
          addMinutes(order.deliveredAt, 1 / 60),
          'delivery-notification-lambda',
          { provider: 'Twilio', messageSid: `SM-SEED-${order.orderId.slice(0, 8)}` },
        ),
      );
    }
    return result;
  });
  await Promise.all(events.map((event) => putOnce(context, event)));

  const proofOrder = orders.find(
    (order) => order.orderId === 'f2d6e07d-a558-4026-9f2d-6fa637e097d3',
  )!;
  const objectKey = `proof-of-delivery/${proofOrder.orderId}/seed-proof.png`;
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await context.storageClient.send(
    new PutObjectCommand({
      Bucket: context.proofBucket,
      Key: objectKey,
      Body: bytes,
      ContentType: 'image/png',
      Metadata: { orderid: proofOrder.orderId },
    }),
  );
  await putOnce(context, {
    ...DynamoKeys.orderProof(proofOrder.orderId),
    orderId: proofOrder.orderId,
    objectKey,
    contentType: 'image/png',
    size: bytes.byteLength,
    etag: 'local-seed-proof',
    uploadedBy: proofOrder.driverId,
    uploadedAt: addMinutes(proofOrder.deliveredAt!, -2),
  });
  await putOnce(context, {
    PK: 'LOCAL_FIXTURE',
    SK: LOCAL_FIXTURE_VERSION,
    version: LOCAL_FIXTURE_VERSION,
    appliedAt: new Date().toISOString(),
  });
  await context.storageClient.send(
    new PutObjectCommand({
      Bucket: context.analyticsBucket,
      Key: 'analytics/latest/overview.json',
      Body: JSON.stringify(analyticsSnapshot()),
      ContentType: 'application/json',
    }),
  );
  console.info(`Seeded local fixture ${LOCAL_FIXTURE_VERSION}`);
};
