import { PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoKeys } from '../../../infrastructure/dynamodb/dynamo-keys.js';
import type { LocalBootstrapContext } from '../config.js';
import { createAnalyticsSnapshot } from './analytics-snapshot.js';
import { addMinutes, ensureActiveOrderLock, putOnce, seedEvent } from './fixture-helpers.js';

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
      Body: JSON.stringify(createAnalyticsSnapshot(LOCAL_FIXTURE_VERSION)),
      ContentType: 'application/json',
    }),
  );
  console.info(`Seeded local fixture ${LOCAL_FIXTURE_VERSION}`);
};
