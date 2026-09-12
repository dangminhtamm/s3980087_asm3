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

export const createAnalyticsSnapshot = (fixtureVersion: string) => {
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
    fixtureVersion,
    generatedAt: generatedAt.toISOString(),
    coverage: { from: daily[0]!.date, to: daily.at(-1)!.date },
    daily,
  };
};
