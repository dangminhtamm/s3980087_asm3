import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  ListBucketsCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const requiredEnvironmentVariable = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const region = requiredEnvironmentVariable('AWS_REGION');
const tableName = requiredEnvironmentVariable('DYNAMODB_TABLE_NAME');
const proofBucket = requiredEnvironmentVariable('S3_DELIVERY_PROOF_BUCKET');
const analyticsBucket = requiredEnvironmentVariable('S3_ANALYTICS_BUCKET');
const dynamoEndpoint = requiredEnvironmentVariable('DYNAMODB_ENDPOINT');
const s3Endpoint = requiredEnvironmentVariable('S3_ENDPOINT');

const dynamoClient = new DynamoDBClient({ region, endpoint: dynamoEndpoint });
const documentClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});
const storageClient = new S3Client({
  region,
  endpoint: s3Endpoint,
  forcePathStyle: true,
});

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (
  label: string,
  check: () => Promise<unknown>,
): Promise<void> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      await check();
      console.info(`${label} is ready`);
      return;
    } catch (error: unknown) {
      lastError = error;
      if (attempt < 40) await sleep(750);
    }
  }

  throw new Error(`${label} did not become ready`, { cause: lastError });
};

const isNamedError = (error: unknown, names: string[]): boolean =>
  error instanceof Error && names.includes(error.name);

const ensureTable = async (): Promise<void> => {
  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
    console.info(`DynamoDB table ${tableName} already exists`);
    return;
  } catch (error: unknown) {
    if (!isNamedError(error, ['ResourceNotFoundException'])) throw error;
  }

  await dynamoClient.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
        { AttributeName: 'GSI2PK', AttributeType: 'S' },
        { AttributeName: 'GSI2SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
        {
          IndexName: 'GSI2',
          KeySchema: [
            { AttributeName: 'GSI2PK', KeyType: 'HASH' },
            { AttributeName: 'GSI2SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );

  await waitUntilTableExists(
    { client: dynamoClient, maxWaitTime: 30 },
    { TableName: tableName },
  );
  console.info(`Created DynamoDB table ${tableName}`);
};

const ensureBucket = async (bucketName: string): Promise<void> => {
  try {
    await storageClient.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.info(`S3 bucket ${bucketName} already exists`);
    return;
  } catch {
    // A missing local bucket is expected on the first run.
  }

  await storageClient.send(
    new CreateBucketCommand({
      Bucket: bucketName,
      ...(region === 'us-east-1'
        ? {}
        : {
            CreateBucketConfiguration: {
              LocationConstraint: region as BucketLocationConstraint,
            },
          }),
    }),
  );
  console.info(`Created S3 bucket ${bucketName}`);
};

const putSeedItem = async (item: Record<string, unknown>): Promise<void> => {
  try {
    await documentClient.send(
      new PutCommand({
        TableName: tableName,
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

const buildHourlyVolume = (
  orderCount: number,
  seed: number,
): Array<{ hour: number; orderCount: number }> => {
  const weights = [
    0.2, 0.1, 0.1, 0.1, 0.1, 0.2, 0.6, 1.2, 2.8, 4.8, 5.6, 5.1,
    4.4, 4.7, 5.4, 6.2, 7.1, 6.8, 5.1, 3.4, 2.2, 1.3, 0.7, 0.4,
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

const buildLocalAnalyticsSnapshot = () => {
  const generatedAt = new Date();
  const coverageTo = new Date(generatedAt);
  coverageTo.setUTCHours(0, 0, 0, 0);
  const regionProfiles = [
    { region: 'District 1', baseVolume: 22, successRate: 0.974, averageMinutes: 29 },
    { region: 'District 3', baseVolume: 18, successRate: 0.962, averageMinutes: 33 },
    { region: 'Binh Thanh', baseVolume: 21, successRate: 0.948, averageMinutes: 39 },
    { region: 'District 7', baseVolume: 17, successRate: 0.969, averageMinutes: 36 },
    { region: 'Thu Duc', baseVolume: 24, successRate: 0.886, averageMinutes: 52 },
  ];

  const daily = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(coverageTo.getTime() - (119 - index) * 86_400_000);
    const dayOfWeek = date.getUTCDay();
    const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.78 : 1;
    const growthFactor = 0.86 + index * 0.0024;
    const regions = regionProfiles.map((profile, regionIndex) => {
      const variation = 1 + Math.sin(index * 0.61 + regionIndex) * 0.13;
      const orderCount = Math.max(
        3,
        Math.round(profile.baseVolume * weekendFactor * growthFactor * variation),
      );
      const rateVariation = Math.sin(index * 0.27 + regionIndex) * 0.012;
      const deliveredOrders = Math.min(
        orderCount,
        Math.round(orderCount * (profile.successRate + rateVariation)),
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
        hourlyOrderVolume: buildHourlyVolume(orderCount, index + regionIndex * 3),
      };
    });
    const hourlyOrderVolume = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orderCount: regions.reduce(
        (sum, region) => sum + (region.hourlyOrderVolume[hour]?.orderCount ?? 0),
        0,
      ),
    }));

    return {
      date: date.toISOString().slice(0, 10),
      totalOrders: regions.reduce((sum, region) => sum + region.orderCount, 0),
      deliveredOrders: regions.reduce((sum, region) => sum + region.deliveredOrders, 0),
      totalDeliveryMinutes: Math.round(
        regions.reduce((sum, region) => sum + region.totalDeliveryMinutes, 0) * 100,
      ) / 100,
      deliveryDurationCount: regions.reduce(
        (sum, region) => sum + region.deliveryDurationCount,
        0,
      ),
      hourlyOrderVolume,
      regions,
    };
  });

  return {
    schemaVersion: 2,
    generatedAt: generatedAt.toISOString(),
    coverage: { from: daily[0]!.date, to: daily.at(-1)!.date },
    daily,
  } as const;
};

const createSeedEvent = (
  orderId: string,
  type: string,
  occurredAt: string,
  actorId: string,
  metadata: Record<string, string> = {},
): Record<string, unknown> => {
  const eventId = `seed-${type.toLowerCase()}`;
  return {
    PK: `ORDER#${orderId}`,
    SK: `EVENT#${occurredAt}#${eventId}`,
    eventId,
    orderId,
    type,
    occurredAt,
    actorId,
    source: 'RECORDED',
    metadata,
  };
};

const ensureSeedActiveOrderLock = async (orderId: string, driverId: string): Promise<void> => {
  try {
    await documentClient.send(new TransactWriteCommand({ TransactItems: [
      {
        ConditionCheck: {
          TableName: tableName,
          Key: { PK: `ORDER#${orderId}`, SK: 'METADATA' },
          ConditionExpression: '#status = :inProgress',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':inProgress': 'IN_PROGRESS' },
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: { PK: `DRIVER#${driverId}`, SK: 'PROFILE' },
          UpdateExpression: 'SET activeOrderId = if_not_exists(activeOrderId, :orderId)',
          ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(activeOrderId) OR activeOrderId = :orderId)',
          ExpressionAttributeValues: { ':orderId': orderId },
        },
      },
    ] }));
  } catch (error: unknown) {
    // Existing local data may have progressed past the seed snapshot or the
    // driver may already hold another valid lock. Never rewind that state.
    if (!isNamedError(error, ['TransactionCanceledException'])) throw error;
  }
};

const migrateLegacyAssignedOrders = async (): Promise<void> => {
  const result = await documentClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :pending',
    ExpressionAttributeValues: { ':pending': 'ORDER_STATUS#PENDING' },
  }));
  const legacyAssigned = (result.Items ?? []).filter(
    (item) => typeof item.orderId === 'string' && typeof item.driverId === 'string',
  );
  await Promise.all(legacyAssigned.map((item) => documentClient.send(new UpdateCommand({
    TableName: tableName,
    Key: { PK: `ORDER#${item.orderId as string}`, SK: 'METADATA' },
    UpdateExpression: 'SET #status = :assigned, GSI1SK = :gsi1sk, GSI2PK = :gsi2pk',
    ConditionExpression: '#status = :pending AND attribute_exists(driverId)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':assigned': 'ASSIGNED',
      ':pending': 'PENDING',
      ':gsi1sk': `STATUS#ASSIGNED#CREATED#${item.createdAt as string}#ORDER#${item.orderId as string}`,
      ':gsi2pk': 'ORDER_STATUS#ASSIGNED',
    },
  }))));
  if (legacyAssigned.length > 0) {
    console.info(`Migrated ${legacyAssigned.length} legacy assigned orders`);
  }
};

const seedData = async (): Promise<void> => {
  const drivers = [
    {
      driverId: 'DRV-018', name: 'Minh Duy', phone: '+84901110018',
      vehiclePlate: '51A-482.17', currentArea: 'District 1', status: 'ON_DELIVERY',
      completedToday: 8, lat: 10.7738, lng: 106.7018,
      activeOrderId: '0fe1212c-930a-47af-93a7-480ca0a3e771',
      locationUpdatedAt: '2026-08-24T03:12:00.000Z', updatedAt: '2026-08-24T03:12:00.000Z',
    },
    {
      driverId: 'DRV-026', name: 'Hải Nam', phone: '+84901110026',
      vehiclePlate: '59C-318.42', currentArea: 'Thu Duc', status: 'ON_DELIVERY',
      completedToday: 6, lat: 10.7881, lng: 106.7461,
      locationUpdatedAt: '2026-08-24T03:08:00.000Z', updatedAt: '2026-08-24T03:08:00.000Z',
    },
    {
      driverId: 'DRV-011', name: 'Thanh An', phone: '+84901110011',
      vehiclePlate: '50H-921.06', currentArea: 'District 7', status: 'AVAILABLE',
      completedToday: 7, lat: 10.7398, lng: 106.7122,
      locationUpdatedAt: '2026-08-24T03:02:00.000Z', updatedAt: '2026-08-24T03:02:00.000Z',
    },
    {
      driverId: 'DRV-032', name: 'Hoàng Sơn', phone: '+84901110032',
      vehiclePlate: '51D-104.38', currentArea: 'Binh Thanh', status: 'OFFLINE',
      completedToday: 0, lat: null, lng: null,
      locationUpdatedAt: null, updatedAt: '2026-08-24T01:14:00.000Z',
    },
  ] as const;

  const orders = [
    {
      orderId: '0fe1212c-930a-47af-93a7-480ca0a3e771', customerName: 'Nguyễn Minh Anh',
      customerPhone: '+84901234567', dropoffAddress: '72 Nguyen Hue Street, District 1, Ho Chi Minh City',
      region: 'District 1', lat: 10.77428, lng: 106.70391, status: 'IN_PROGRESS',
      driverId: 'DRV-018', createdAt: '2026-08-24T02:45:00.000Z', deliveredAt: null,
    },
    {
      orderId: '0c8e3c60-05b1-46de-a947-79aa26e67075', customerName: 'Trần Lan Anh',
      customerPhone: '+84912345678', dropoffAddress: '15 Vo Van Tan Street, District 3, Ho Chi Minh City',
      region: 'District 3', lat: 10.77712, lng: 106.68842, status: 'PENDING',
      driverId: null, createdAt: '2026-08-24T03:20:00.000Z', deliveredAt: null,
    },
    {
      orderId: 'edccbd70-71f7-4b05-b2b5-dab54fb596d4', customerName: 'Lê Khánh Linh',
      customerPhone: '+84923456789', dropoffAddress: '82 Dien Bien Phu Street, Binh Thanh District, Ho Chi Minh City',
      region: 'Binh Thanh', lat: 10.80122, lng: 106.71014, status: 'PENDING',
      driverId: null, createdAt: '2026-08-24T03:10:00.000Z', deliveredAt: null,
    },
    {
      orderId: '20dcfe10-c53c-4d87-b521-23b75ceaff71', customerName: 'Phạm Tuấn Kiệt',
      customerPhone: '+84934567890', dropoffAddress: '21 Mai Chi Tho Street, Thu Duc City, Ho Chi Minh City',
      region: 'Thu Duc', lat: 10.78752, lng: 106.74915, status: 'ASSIGNED',
      driverId: 'DRV-026', createdAt: '2026-08-24T02:55:00.000Z', deliveredAt: null,
    },
    {
      orderId: 'f2d6e07d-a558-4026-9f2d-6fa637e097d3', customerName: 'Đỗ Bảo Ngọc',
      customerPhone: '+84945678901', dropoffAddress: '119 Lam Van Ben Street, District 7, Ho Chi Minh City',
      region: 'District 7', lat: 10.7391, lng: 106.7131, status: 'DELIVERED',
      driverId: 'DRV-011', createdAt: '2026-08-24T01:32:00.000Z', deliveredAt: '2026-08-24T02:06:00.000Z',
    },
    {
      orderId: '62fcb4ad-1079-437b-a837-87dd2a7ea113', customerName: 'Vũ Quốc Bảo',
      customerPhone: '+84956789012', dropoffAddress: '82 Nguyen Van Troi Street, Phu Nhuan District, Ho Chi Minh City',
      region: 'Phu Nhuan', lat: 10.7962, lng: 106.6732, status: 'DELIVERED',
      driverId: 'DRV-018', createdAt: '2026-08-24T01:10:00.000Z', deliveredAt: '2026-08-24T01:48:00.000Z',
    },
    {
      orderId: 'b5a314f0-bba4-4eaf-b88b-cdb4479632fb', customerName: 'Mai Thu Hà',
      customerPhone: '+84967890123', dropoffAddress: '2 Le Duan Boulevard, District 1, Ho Chi Minh City',
      region: 'District 1', lat: 10.78191, lng: 106.69925, status: 'ASSIGNED',
      driverId: 'DRV-018', createdAt: '2026-09-10T00:45:00.000Z', deliveredAt: null,
    },
  ] as const;

  await Promise.all(
    drivers.map((driver) =>
      putSeedItem({
        PK: `DRIVER#${driver.driverId}`,
        SK: 'PROFILE',
        GSI2PK: `DRIVER_STATUS#${driver.status}`,
        GSI2SK: `UPDATED#${driver.updatedAt}#DRIVER#${driver.driverId}`,
        ...driver,
      }),
    ),
  );
  await migrateLegacyAssignedOrders();

  await Promise.all(
    orders.map((order) =>
      putSeedItem({
        PK: `ORDER#${order.orderId}`,
        SK: 'METADATA',
        GSI2PK: `ORDER_STATUS#${order.status}`,
        GSI2SK: `CREATED#${order.createdAt}#ORDER#${order.orderId}`,
        ...(order.driverId
          ? {
              GSI1PK: `DRIVER#${order.driverId}`,
              GSI1SK: `STATUS#${order.status}#CREATED#${order.createdAt}#ORDER#${order.orderId}`,
            }
          : {}),
        ...order,
      }),
    ),
  );
  await Promise.all(
    orders
      .filter((order) => order.status === 'IN_PROGRESS' && order.driverId)
      .map((order) => ensureSeedActiveOrderLock(order.orderId, order.driverId!)),
  );

  // Seed the same immutable lifecycle records produced by the application.
  // This gives the Admin Order Detail screen a complete timeline immediately.
  const orderEvents = orders.flatMap((order) => {
    const events = [
      createSeedEvent(order.orderId, 'ORDER_CREATED', order.createdAt, 'local-admin'),
    ];
    if (order.driverId) {
      events.push(createSeedEvent(
        order.orderId,
        'DRIVER_ASSIGNED',
        addMinutes(order.createdAt, 5),
        'local-admin',
        { driverId: order.driverId },
      ));
    }
    if (order.status === 'IN_PROGRESS' || order.status === 'DELIVERED') {
      events.push(createSeedEvent(
        order.orderId,
        'DELIVERY_STARTED',
        addMinutes(order.createdAt, 10),
        order.driverId ?? 'local-admin',
      ));
    }
    if (order.status === 'DELIVERED' && order.deliveredAt) {
      events.push(
        createSeedEvent(
          order.orderId,
          'PROOF_UPLOADED',
          addMinutes(order.deliveredAt, -2),
          order.driverId ?? 'local-driver',
        ),
        createSeedEvent(
          order.orderId,
          'DELIVERY_COMPLETED',
          order.deliveredAt,
          order.driverId ?? 'local-driver',
        ),
        createSeedEvent(
          order.orderId,
          'SMS_NOTIFICATION_SENT',
          new Date(new Date(order.deliveredAt).getTime() + 1_000).toISOString(),
          'delivery-notification-lambda',
          { provider: 'Twilio', messageSid: `SM-SEED-${order.orderId.slice(0, 8)}` },
        ),
      );
    }
    return events;
  });
  await Promise.all(orderEvents.map((event) => putSeedItem(event)));

  // Store a tiny valid PNG plus metadata so the signed Proof of Delivery read
  // path can be demonstrated without requiring a driver upload first.
  const proofOrder = orders.find((order) => order.orderId === 'f2d6e07d-a558-4026-9f2d-6fa637e097d3')!;
  const proofObjectKey = `proof-of-delivery/${proofOrder.orderId}/seed-proof.png`;
  const proofBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await storageClient.send(new PutObjectCommand({
    Bucket: proofBucket,
    Key: proofObjectKey,
    Body: proofBytes,
    ContentType: 'image/png',
    Metadata: { orderid: proofOrder.orderId },
  }));
  await putSeedItem({
    PK: `ORDER#${proofOrder.orderId}`,
    SK: 'PROOF#POD',
    orderId: proofOrder.orderId,
    objectKey: proofObjectKey,
    contentType: 'image/png',
    size: proofBytes.byteLength,
    etag: 'local-seed-proof',
    uploadedBy: proofOrder.driverId,
    uploadedAt: addMinutes(proofOrder.deliveredAt!, -2),
  });

  const analyticsSnapshot = buildLocalAnalyticsSnapshot();

  await storageClient.send(
    new PutObjectCommand({
      Bucket: analyticsBucket,
      Key: 'analytics/latest/overview.json',
      Body: JSON.stringify(analyticsSnapshot),
      ContentType: 'application/json',
    }),
  );
  console.info('Seeded local drivers, orders, lifecycle events, proof and analytics snapshot');
};

const main = async (): Promise<void> => {
  try {
    await Promise.all([
      waitFor('DynamoDB Local', () => dynamoClient.send(new ListTablesCommand({}))),
      waitFor('MinIO S3', () => storageClient.send(new ListBucketsCommand({}))),
    ]);
    await ensureTable();
    await Promise.all([ensureBucket(proofBucket), ensureBucket(analyticsBucket)]);
    try {
      await storageClient.send(
        new PutBucketCorsCommand({
          Bucket: proofBucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedMethods: ['PUT'],
                AllowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
                AllowedHeaders: ['Content-Type', 'x-amz-meta-orderid'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    } catch (error: unknown) {
      // Some S3-compatible servers configure CORS globally instead of through
      // PutBucketCors. Compose sets the equivalent MinIO CORS environment value.
      if (!isNamedError(error, ['NotImplemented', 'NotImplementedException'])) {
        throw error;
      }
      console.info('Bucket-level CORS is unavailable; using MinIO global CORS');
    }
    await seedData();
  } finally {
    dynamoClient.destroy();
    storageClient.destroy();
  }
};

main().catch((error: unknown) => {
  console.error('Local infrastructure bootstrap failed', error);
  process.exitCode = 1;
});
