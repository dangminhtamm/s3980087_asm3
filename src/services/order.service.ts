import type { TrackingLink } from '../domain/entities/tracking.js';
import type {
  CreateOrderInput,
  ListOrdersInput,
  Order,
  UpdateOrderStatusInput,
} from '../domain/entities/order.js';
import { AppError } from '../errors/app-error.js';
import type { OrderRepository } from '../repositories/order.repository.js';
import type { AssignDriverUseCase } from '../use-cases/orders/assign-driver.use-case.js';
import type { CreateOrderUseCase } from '../use-cases/orders/create-order.use-case.js';
import type { UpdateOrderStatusUseCase } from '../use-cases/orders/update-order-status.use-case.js';
import type { TrackingTokenService } from './tracking-token.service.js';

/** Stable facade for order callers; business workflows live in focused use cases. */
export class OrderService {
  public constructor(
    private readonly repository: OrderRepository,
    private readonly createOrderUseCase: CreateOrderUseCase,
    private readonly updateOrderStatusUseCase: UpdateOrderStatusUseCase,
    private readonly assignDriverUseCase: AssignDriverUseCase,
    private readonly trackingTokens: TrackingTokenService,
  ) {}

  public createOrder(input: CreateOrderInput, actorId = 'system'): Promise<Order> {
    return this.createOrderUseCase.execute(input, actorId);
  }

  public updateStatus(
    orderId: string,
    input: UpdateOrderStatusInput,
    actorId = 'system',
  ): Promise<Order> {
    return this.updateOrderStatusUseCase.execute(orderId, input, actorId);
  }

  public assignDriver(orderId: string, driverId: string, actorId = 'system'): Promise<Order> {
    return this.assignDriverUseCase.execute(orderId, driverId, actorId);
  }

  public listOrders(input: ListOrdersInput): Promise<Order[]> {
    return this.repository.list(input);
  }

  public getOrder(orderId: string): Promise<Order> {
    return this.repository.getById(orderId);
  }

  public async getTrackingLink(orderId: string): Promise<TrackingLink> {
    await this.repository.getById(orderId);
    return this.trackingTokens.link(orderId);
  }

  public async assertCanUploadProof(orderId: string): Promise<void> {
    const order = await this.repository.getById(orderId);
    if (order.status !== 'ARRIVED')
      throw new AppError(
        409,
        'Proof of delivery can only be uploaded after arrival',
        'PROOF_UPLOAD_NOT_ALLOWED',
      );
  }
}
