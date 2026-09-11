import type { CreateOrderInput, Order } from '../../domain/entities/order.js';
import type { VehicleCapacityPolicy } from '../../domain/policies/vehicle-capacity.policy.js';
import type { ClockPort } from '../../ports/clock.port.js';
import type { IdGeneratorPort } from '../../ports/id-generator.port.js';
import type { OrderRepository } from '../../repositories/order.repository.js';
import type { TrackingTokenService } from '../../services/tracking-token.service.js';

type CreateOrderRepository = Pick<OrderRepository, 'create' | 'getDriverCapacity' | 'list'>;

export class CreateOrderUseCase {
  public constructor(
    private readonly orders: CreateOrderRepository,
    private readonly capacity: VehicleCapacityPolicy,
    private readonly trackingTokens: TrackingTokenService,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  public async execute(input: CreateOrderInput, actorId = 'system'): Promise<Order> {
    const order = this.buildOrder(input);
    if (order.driverId) {
      const [vehicle, current] = await Promise.all([
        this.orders.getDriverCapacity(order.driverId),
        this.orders.list({ driverId: order.driverId, limit: 100 }),
      ]);
      this.capacity.assertFits(vehicle, current, [order]);
    }
    await this.orders.create(order, actorId, this.trackingTokens.issue());
    return order;
  }

  private buildOrder(input: CreateOrderInput): Order {
    return {
      orderId: this.ids.next(),
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      dropoffAddress: input.dropoffAddress,
      region: input.region,
      lat: input.lat,
      lng: input.lng,
      status: input.driverId ? 'ASSIGNED' : 'PENDING',
      driverId: input.driverId ?? null,
      createdAt: this.clock.now().toISOString(),
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
  }
}
