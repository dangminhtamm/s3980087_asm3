import type { Order } from '../domain/entities/order.js';
import type { OrderService } from './order.service.js';

export interface OperationalIssue {
  id: string;
  type:
    | 'DELIVERY_EXCEPTION'
    | 'RESCHEDULE_REQUIRED'
    | 'CUSTOMER_RESCHEDULE_REQUEST'
    | 'SLA_BREACH'
    | 'SLA_RISK'
    | 'UNASSIGNED_URGENT';
  severity: 'CRITICAL' | 'WARNING' | 'NOTICE';
  orderId: string;
  routeId: string | null;
  driverId: string | null;
  title: string;
  detail: string;
  dueAt: string | null;
  predictedAt: string | null;
}

const isTerminal = (order: Order): boolean =>
  ['DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.status);

export class OperationsService {
  public constructor(private readonly orders: OrderService) {}

  public async listIssues(limit: number, now = new Date()): Promise<OperationalIssue[]> {
    const orders = await this.orders.listOrders({ limit: 100 });
    const nowMs = now.getTime();
    const issues = orders.flatMap((order): OperationalIssue[] => {
      if (isTerminal(order)) return [];
      const common = { orderId: order.orderId, routeId: order.routeId, driverId: order.driverId };
      if (order.customerRescheduleRequest)
        return [
          {
            id: `CUSTOMER_RESCHEDULE_REQUEST#${order.orderId}`,
            type: 'CUSTOMER_RESCHEDULE_REQUEST',
            severity: 'CRITICAL',
            ...common,
            title: 'Customer requested a new delivery time',
            detail:
              order.customerRescheduleRequest.notes ??
              'Review the requested window and contact the customer if needed.',
            dueAt: order.customerRescheduleRequest.requestedWindowEnd,
            predictedAt: order.customerRescheduleRequest.requestedWindowStart,
          },
        ];
      if (order.status === 'DELIVERY_FAILED')
        return [
          {
            id: `DELIVERY_EXCEPTION#${order.orderId}`,
            type: 'DELIVERY_EXCEPTION',
            severity: 'CRITICAL',
            ...common,
            title: 'Delivery failed — decision required',
            detail:
              order.exception?.notes ??
              order.exception?.reason.replaceAll('_', ' ') ??
              'Review and reschedule or return this order.',
            dueAt: order.timeWindowEnd,
            predictedAt: order.plannedArrivalAt,
          },
        ];
      if (order.status === 'RESCHEDULED')
        return [
          {
            id: `RESCHEDULE_REQUIRED#${order.orderId}`,
            type: 'RESCHEDULE_REQUIRED',
            severity: 'WARNING',
            ...common,
            title: 'Rescheduled order needs dispatch',
            detail: 'Assign a new route and delivery window.',
            dueAt: order.timeWindowEnd,
            predictedAt: order.plannedArrivalAt,
          },
        ];
      const dueMs = order.timeWindowEnd ? Date.parse(order.timeWindowEnd) : null;
      const predictedMs = order.plannedArrivalAt ? Date.parse(order.plannedArrivalAt) : null;
      if (dueMs && nowMs > dueMs)
        return [
          {
            id: `SLA_BREACH#${order.orderId}`,
            type: 'SLA_BREACH',
            severity: 'CRITICAL',
            ...common,
            title: 'SLA delivery window breached',
            detail: `${Math.ceil((nowMs - dueMs) / 60_000)} minutes past the promised window.`,
            dueAt: order.timeWindowEnd,
            predictedAt: order.plannedArrivalAt,
          },
        ];
      if (dueMs && predictedMs && predictedMs > dueMs)
        return [
          {
            id: `SLA_RISK#${order.orderId}`,
            type: 'SLA_RISK',
            severity: 'WARNING',
            ...common,
            title: 'Predicted to miss SLA',
            detail: `Planned ETA is ${Math.ceil((predictedMs - dueMs) / 60_000)} minutes after the promised window.`,
            dueAt: order.timeWindowEnd,
            predictedAt: order.plannedArrivalAt,
          },
        ];
      const startsMs = order.timeWindowStart ? Date.parse(order.timeWindowStart) : null;
      if (!order.driverId && startsMs && startsMs <= nowMs + 30 * 60_000)
        return [
          {
            id: `UNASSIGNED_URGENT#${order.orderId}`,
            type: 'UNASSIGNED_URGENT',
            severity: 'WARNING',
            ...common,
            title: 'Urgent order is still unassigned',
            detail: 'Delivery window starts within 30 minutes.',
            dueAt: order.timeWindowEnd,
            predictedAt: null,
          },
        ];
      return [];
    });
    const rank = { CRITICAL: 0, WARNING: 1, NOTICE: 2 } as const;
    return issues
      .sort(
        (left, right) =>
          rank[left.severity] - rank[right.severity] ||
          String(left.dueAt).localeCompare(String(right.dueAt)),
      )
      .slice(0, limit);
  }
}
