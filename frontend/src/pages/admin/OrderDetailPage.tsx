import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { ErrorState, PageSkeleton, useToast } from '../../components/ui';
import { getDriver } from '../../features/drivers/api/drivers.client';
import {
  getOrder,
  getOrderEvents,
  getOrderTrackingLink,
  updateOrderStatus,
} from '../../features/orders/api/orders.client';
import {
  getDeliveryProof,
  getDeliveryProofViewUrl,
} from '../../features/proof-of-delivery/api/proof.client';
import type { AdminOrder, FleetDriver, OrderEvent } from '../../types/admin';
import type { DeliveryProof } from '../../types/order';
import { OrderDetailView } from '../../features/orders/components/OrderDetailView';

const dateTime = (value: string | null | undefined): string =>
  value
    ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Not recorded';

export const OrderDetailPage = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const { toast } = useToast();
  const [order, setOrder] = useState<AdminOrder | null>(null);
  const [driver, setDriver] = useState<FleetDriver | null>(null);
  const [events, setEvents] = useState<OrderEvent[]>([]);
  const [proof, setProof] = useState<DeliveryProof | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [isCopyingTracking, setIsCopyingTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    setIsLoading(true);
    setError(null);
    try {
      const orderResult = await getOrder(orderId);
      const loadedOrder = orderResult.data;
      setOrder(loadedOrder);
      const [eventResult, driverResult, proofResult] = await Promise.allSettled([
        getOrderEvents(orderId),
        loadedOrder.driverId ? getDriver(loadedOrder.driverId) : Promise.resolve(null),
        getDeliveryProof(orderId),
      ]);
      setEvents(eventResult.status === 'fulfilled' ? eventResult.value : []);
      setDriver(
        driverResult.status === 'fulfilled' && driverResult.value ? driverResult.value.data : null,
      );
      if (proofResult.status === 'fulfilled') {
        setProof(proofResult.value);
        try {
          setProofUrl((await getDeliveryProofViewUrl(orderId)).viewUrl);
        } catch {
          setProofUrl(null);
        }
      } else {
        setProof(null);
        setProofUrl(null);
      }
    } catch (loadError: unknown) {
      setError(
        axios.isAxiosError(loadError)
          ? (loadError.response?.data?.error?.message ?? 'Unable to load this order.')
          : 'Unable to load this order.',
      );
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startDelivery = async () => {
    if (!order) return;
    setIsStarting(true);
    try {
      const result = await updateOrderStatus(order.orderId, 'IN_PROGRESS');
      setOrder(result.data);
      setConfirmStart(false);
      toast({
        title: 'Delivery started',
        description: 'The assigned driver can now begin the route.',
        tone: 'success',
      });
      await load();
    } catch {
      setError('Unable to start the delivery.');
    } finally {
      setIsStarting(false);
    }
  };

  const copyTrackingLink = async () => {
    if (!order) return;
    setIsCopyingTracking(true);
    try {
      const link = await getOrderTrackingLink(order.orderId);
      await navigator.clipboard.writeText(link.url);
      toast({
        title: 'Tracking link copied',
        description: `Private link expires ${dateTime(link.expiresAt)}.`,
        tone: 'success',
      });
    } catch {
      setError('Unable to copy the customer tracking link.');
    } finally {
      setIsCopyingTracking(false);
    }
  };

  const changeStatus = async (
    status: 'DELIVERY_FAILED' | 'RESCHEDULED' | 'CANCELLED' | 'RETURNING' | 'RETURNED',
  ) => {
    if (!order) return;
    const needsReason = status === 'DELIVERY_FAILED' || status === 'CANCELLED';
    const notes = needsReason ? window.prompt('Add an operational reason or note:') : null;
    if (needsReason && notes === null) return;
    setIsUpdatingStatus(true);
    setError(null);
    try {
      const result = await updateOrderStatus(
        order.orderId,
        status,
        needsReason ? { reason: 'OTHER', notes: notes || undefined } : undefined,
      );
      setOrder(result.data);
      toast({
        title: 'Order updated',
        description: `Status changed to ${status.replaceAll('_', ' ').toLowerCase()}.`,
        tone: 'success',
      });
      await load();
    } catch (statusError: unknown) {
      setError(
        axios.isAxiosError(statusError)
          ? (statusError.response?.data?.error?.message ?? 'Unable to update this order.')
          : 'Unable to update this order.',
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const timestamps = useMemo(
    () => ({
      assigned: events.find((event) => event.type === 'DRIVER_ASSIGNED')?.occurredAt,
      started: events.find((event) => event.type === 'DELIVERY_STARTED')?.occurredAt,
    }),
    [events],
  );
  const smsEvent = [...events]
    .reverse()
    .find(
      (event) => event.type === 'SMS_NOTIFICATION_SENT' || event.type === 'SMS_NOTIFICATION_FAILED',
    );

  if (isLoading)
    return (
      <main className="mx-auto max-w-[94rem] px-5 py-10">
        <PageSkeleton />
      </main>
    );
  if (error && !order)
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <ErrorState message={error} onRetry={() => void load()} />
      </main>
    );
  if (!order) return null;

  const status = {
    PENDING: { label: 'Pending', tone: 'neutral' as const },
    ASSIGNED: { label: 'Assigned', tone: 'info' as const },
    IN_PROGRESS: { label: 'In transit', tone: 'warning' as const },
    ARRIVED: { label: 'Arrived', tone: 'warning' as const },
    DELIVERED: { label: 'Delivered', tone: 'success' as const },
    DELIVERY_FAILED: { label: 'Delivery failed', tone: 'danger' as const },
    RESCHEDULED: { label: 'Rescheduled', tone: 'neutral' as const },
    CANCELLED: { label: 'Cancelled', tone: 'danger' as const },
    RETURNING: { label: 'Returning', tone: 'warning' as const },
    RETURNED: { label: 'Returned', tone: 'neutral' as const },
  }[order.status];
  return (
    <OrderDetailView
      order={order}
      driver={driver}
      events={events}
      proof={proof}
      proofUrl={proofUrl}
      timestamps={timestamps}
      smsEvent={smsEvent}
      status={status}
      error={error}
      isCopyingTracking={isCopyingTracking}
      isUpdatingStatus={isUpdatingStatus}
      confirmStart={confirmStart}
      isStarting={isStarting}
      setConfirmStart={setConfirmStart}
      startDelivery={startDelivery}
      copyTrackingLink={copyTrackingLink}
      changeStatus={changeStatus}
    />
  );
};
