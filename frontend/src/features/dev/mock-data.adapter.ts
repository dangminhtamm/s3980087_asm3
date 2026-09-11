import type {
  AdminOrder,
  AnalyticsOverviewData,
  DriverStatus,
  FleetDriver,
  OrderExceptionReason,
} from '../../types/admin';

const now = () => new Date().toISOString();

const seedOrders: AdminOrder[] = [
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
    exception: null,
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
    exception: null,
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
    exception: null,
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
    exception: null,
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
    exception: null,
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
    exception: null,
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
    exception: null,
  },
];

const seedDrivers: FleetDriver[] = [
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
];

const buildFallbackAnalytics = (params?: {
  from?: string;
  to?: string;
  region?: string;
}): AnalyticsOverviewData => {
  const to = params?.to ?? new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(`${to}T00:00:00.000Z`);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  const from = params?.from ?? defaultFrom.toISOString().slice(0, 10);
  const days = Math.max(
    1,
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1,
  );
  const profiles = [
    {
      region: 'District 1',
      daily: 22,
      successRate: 97.4,
      averageDeliveryMinutes: 29,
      isAbnormal: false,
    },
    {
      region: 'District 3',
      daily: 18,
      successRate: 96.2,
      averageDeliveryMinutes: 33,
      isAbnormal: false,
    },
    {
      region: 'District 7',
      daily: 17,
      successRate: 96.9,
      averageDeliveryMinutes: 36,
      isAbnormal: false,
    },
    {
      region: 'Binh Thanh',
      daily: 21,
      successRate: 94.8,
      averageDeliveryMinutes: 39,
      isAbnormal: false,
    },
    {
      region: 'Thu Duc',
      daily: 24,
      successRate: 88.6,
      averageDeliveryMinutes: 52,
      isAbnormal: true,
    },
  ];
  const regions = profiles
    .map((profile, index) => {
      const orderCount = profile.daily * days;
      return {
        region: profile.region,
        orderCount,
        deliveredOrders: Math.round((orderCount * profile.successRate) / 100),
        successRate: profile.successRate,
        averageDeliveryMinutes: profile.averageDeliveryMinutes,
        rankBySpeed: index + 1,
        isAbnormal: profile.isAbnormal,
      };
    })
    .sort((left, right) => left.averageDeliveryMinutes - right.averageDeliveryMinutes)
    .map((region, index) => ({ ...region, rankBySpeed: index + 1 }));
  const selected = params?.region
    ? regions.find((region) => region.region === params.region)
    : null;
  const totalOrders =
    selected?.orderCount ?? regions.reduce((sum, region) => sum + region.orderCount, 0);
  const deliveredOrders =
    selected?.deliveredOrders ?? regions.reduce((sum, region) => sum + region.deliveredOrders, 0);
  const averageDeliveryMinutes = selected?.averageDeliveryMinutes ?? 38;
  const successRate =
    totalOrders === 0 ? 0 : Math.round((deliveredOrders / totalOrders) * 10_000) / 100;
  const deliveryVolumeTrend = Array.from({ length: days }, (_, index) => {
    const date = new Date(`${from}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    const wave = 0.84 + Math.sin(index * 0.72) * 0.13 + (index / Math.max(1, days)) * 0.18;
    const orderCount = Math.max(1, Math.round((totalOrders / days) * wave));
    return {
      date: date.toISOString().slice(0, 10),
      orderCount,
      deliveredOrders: Math.round((orderCount * successRate) / 100),
    };
  });
  const previousTotal = Math.round(totalOrders / 1.064);
  const previousDelivered = Math.round(deliveredOrders / 1.071);
  const previousAverage = Math.round(averageDeliveryMinutes * 1.058 * 100) / 100;
  const previousToDate = new Date(`${from}T00:00:00.000Z`);
  previousToDate.setUTCDate(previousToDate.getUTCDate() - 1);
  const previousFromDate = new Date(previousToDate);
  previousFromDate.setUTCDate(previousFromDate.getUTCDate() - days + 1);

  return {
    generatedAt: new Date().toISOString(),
    coverage: { from: '2026-01-01', to },
    period: { from, to },
    selectedRegion: params?.region ?? null,
    totalOrders,
    deliveredOrders,
    successRate,
    averageDeliveryMinutes,
    comparison: {
      previousPeriod: {
        from: previousFromDate.toISOString().slice(0, 10),
        to: previousToDate.toISOString().slice(0, 10),
      },
      previous: {
        totalOrders: previousTotal,
        deliveredOrders: previousDelivered,
        successRate: previousTotal
          ? Math.round((previousDelivered / previousTotal) * 10_000) / 100
          : 0,
        averageDeliveryMinutes: previousAverage,
      },
      totalOrdersChangePercent: 6.4,
      deliveredOrdersChangePercent: 7.1,
      successRateChangePoints: 0.6,
      averageDeliveryMinutesChangePercent: -5.5,
    },
    deliveryVolumeTrend,
    hourlyOrderVolume: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      orderCount: Math.round(
        totalOrders *
          ([
            0.004, 0.002, 0.002, 0.002, 0.003, 0.006, 0.012, 0.025, 0.055, 0.08, 0.09, 0.085, 0.07,
            0.075, 0.09, 0.1, 0.11, 0.105, 0.075, 0.045, 0.025, 0.015, 0.01, 0.007,
          ][hour] ?? 0),
      ),
    })),
    regions,
  };
};

class DevMockDataAdapter {
  private orders = structuredClone(seedOrders);
  private drivers = structuredClone(seedDrivers);

  listOrders() {
    return structuredClone(this.orders);
  }
  getOrder(orderId: string) {
    return structuredClone(
      this.orders.find((order) => order.orderId === orderId) ?? this.orders[0]!,
    );
  }
  createOrder(
    input: Omit<
      AdminOrder,
      'orderId' | 'status' | 'createdAt' | 'deliveredAt' | 'exception' | 'driverId'
    > & { driverId?: string | null },
  ) {
    const order: AdminOrder = {
      ...input,
      driverId: input.driverId ?? null,
      orderId: crypto.randomUUID(),
      status: input.driverId ? 'ASSIGNED' : 'PENDING',
      createdAt: now(),
      deliveredAt: null,
      exception: null,
    };
    this.orders = [order, ...this.orders];
    return structuredClone(order);
  }
  assignOrder(orderId: string, driverId: string) {
    const updated = this.updateOrder(orderId, (order) => ({
      ...order,
      driverId,
      status: 'ASSIGNED',
      exception: null,
    }));
    this.drivers = this.drivers.map((driver) =>
      driver.driverId === driverId
        ? { ...driver, status: 'ON_DELIVERY', updatedAt: now() }
        : driver,
    );
    return updated;
  }
  updateStatus(
    orderId: string,
    status: AdminOrder['status'],
    exception?: { reason: OrderExceptionReason; notes?: string },
  ) {
    const current = this.orders.find((order) => order.orderId === orderId);
    const updated = this.updateOrder(orderId, (order) => ({
      ...order,
      status,
      deliveredAt: status === 'DELIVERED' ? now() : order.deliveredAt,
      exception: exception
        ? {
            reason: exception.reason,
            notes: exception.notes ?? null,
            reportedAt: now(),
            reportedBy: 'mock-user',
          }
        : order.exception,
    }));
    if (status === 'DELIVERED' && current?.driverId) {
      this.drivers = this.drivers.map((driver) =>
        driver.driverId === current.driverId
          ? {
              ...driver,
              status: 'AVAILABLE',
              completedToday: driver.completedToday + 1,
              updatedAt: now(),
            }
          : driver,
      );
    }
    return updated;
  }
  listDrivers(status?: DriverStatus) {
    return structuredClone(this.drivers.filter((driver) => !status || driver.status === status));
  }
  getDriver(driverId: string) {
    return structuredClone(
      this.drivers.find((driver) => driver.driverId === driverId) ?? this.drivers[0]!,
    );
  }
  createDriver(
    input: Pick<FleetDriver, 'name' | 'phone' | 'vehiclePlate' | 'currentArea'> &
      Partial<Pick<FleetDriver, 'maxWeightKg' | 'maxVolumeM3'>>,
  ) {
    const driver: FleetDriver = {
      driverId: `DRV-${String(this.drivers.length + 40).padStart(3, '0')}`,
      ...input,
      status: 'AVAILABLE',
      completedToday: 0,
      lat: null,
      lng: null,
      locationUpdatedAt: null,
      updatedAt: now(),
    };
    this.drivers = [driver, ...this.drivers];
    return structuredClone(driver);
  }
  updateDriverStatus(driverId: string, status: DriverStatus) {
    const current = this.drivers.find((driver) => driver.driverId === driverId);
    if (!current) throw new Error('Mock driver not found');
    const updated = { ...current, status, updatedAt: now() };
    this.drivers = this.drivers.map((driver) => (driver.driverId === driverId ? updated : driver));
    return structuredClone(updated);
  }
  analytics(params?: { from?: string; to?: string; region?: string }): AnalyticsOverviewData {
    return buildFallbackAnalytics(params);
  }
  private updateOrder(orderId: string, change: (order: AdminOrder) => AdminOrder) {
    const current = this.orders.find((order) => order.orderId === orderId);
    if (!current) throw new Error('Mock order not found');
    const updated = change(current);
    this.orders = this.orders.map((order) => (order.orderId === orderId ? updated : order));
    return structuredClone(updated);
  }
}

export const devMockData = new DevMockDataAdapter();
