import type { AuthenticatedUser } from '../domain/entities/auth.js';
import type { CreateOrderInput, Order, UpdateOrderStatusInput } from '../domain/entities/order.js';
import type { ProofContentType } from '../domain/entities/delivery-proof.js';
import type { TrackingLink } from '../domain/entities/tracking.js';
import type { PresignedUpload } from '../utils/s3-presigned-url.js';
import type { OrderAssignmentService } from './order-assignment.service.js';
import type { OrderCsvService, OrderExportResult, OrderImportResult } from './order-csv.service.js';
import type { OrderEventService } from './order-event.service.js';
import type { OrderService } from './order.service.js';
import type { DeliveryProofWorkflowService } from './delivery-proof-workflow.service.js';
import type { OrderEvent } from '../domain/entities/order-event.js';

export interface ListOrdersInput {
  status?: Order['status'] | undefined;
  driverId?: string | undefined;
  limit: number;
}

export class OrderApplicationService {
  public constructor(
    private readonly orders: OrderService,
    private readonly events: OrderEventService,
    private readonly assignments: OrderAssignmentService,
    private readonly csv: OrderCsvService,
    private readonly proofs: DeliveryProofWorkflowService,
  ) {}

  public create(input: CreateOrderInput, user: AuthenticatedUser): Promise<Order> {
    return this.orders.createOrder(input, user.username);
  }

  public updateStatus(
    orderId: string,
    input: UpdateOrderStatusInput,
    user: AuthenticatedUser,
  ): Promise<Order> {
    return this.orders.updateStatus(orderId, input, user.username);
  }

  public list(input: ListOrdersInput, user: AuthenticatedUser): Promise<Order[]> {
    const scopedInput = user.roles.includes('ADMIN')
      ? input
      : { ...input, driverId: user.username };
    return this.orders.listOrders(scopedInput);
  }

  public get(orderId: string): Promise<Order> {
    return this.orders.getOrder(orderId);
  }

  public getTrackingLink(orderId: string): Promise<TrackingLink> {
    return this.orders.getTrackingLink(orderId);
  }

  public assign(orderId: string, driverId: string, user: AuthenticatedUser): Promise<Order> {
    return this.assignments.assign(orderId, driverId, user.username);
  }

  public createUploadUrl(orderId: string, contentType: ProofContentType): Promise<PresignedUpload> {
    return this.proofs.createUploadUrl(orderId, contentType);
  }

  public async listEvents(orderId: string): Promise<OrderEvent[]> {
    const order = await this.orders.getOrder(orderId);
    return this.events.list(order);
  }

  public importCsv(csv: unknown, user: AuthenticatedUser): Promise<OrderImportResult> {
    return this.csv.importOrders(csv, user.username);
  }

  public exportCsv(input: ListOrdersInput): Promise<OrderExportResult> {
    return this.csv.exportOrders(input);
  }
}
