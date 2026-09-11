import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { DetailLocationMap } from '../../components/admin/DetailLocationMap';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageSkeleton,
  StatusBadge,
  useToast,
} from '../../components/ui';
import {
  getDeliveryProof,
  getDeliveryProofViewUrl,
  getDriver,
  getOrder,
  getOrderEvents,
  getOrderTrackingLink,
  updateOrderStatus,
} from '../../services/operations';
import type { AdminOrder, FleetDriver, OrderEvent, OrderEventType } from '../../types/admin';
import type { DeliveryProof } from '../../types/order';
import { formatLocationInEnglish } from '../../utils/location';

const eventLabels: Record<OrderEventType, string> = {
  ORDER_CREATED: 'Order created',
  DRIVER_ASSIGNED: 'Driver assigned',
  DELIVERY_STARTED: 'Delivery started',
  DRIVER_ARRIVED: 'Driver arrived',
  DELIVERY_FAILED: 'Delivery failed',
  DELIVERY_RESCHEDULED: 'Delivery rescheduled',
  ORDER_CANCELLED: 'Order cancelled',
  RETURN_STARTED: 'Return started',
  ORDER_RETURNED: 'Order returned',
  PROOF_UPLOADED: 'Proof of Delivery uploaded',
  DELIVERY_COMPLETED: 'Delivery completed',
  SMS_NOTIFICATION_SENT: 'Customer SMS sent',
  SMS_NOTIFICATION_FAILED: 'Customer SMS failed',
  CUSTOMER_RESCHEDULE_REQUESTED: 'Customer requested reschedule',
  CUSTOMER_FEEDBACK_RECEIVED: 'Customer feedback received',
};

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
    <main className="mx-auto max-w-[94rem] px-4 py-7 sm:px-8 sm:py-10 xl:px-12">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            to="/admin/orders"
            className="text-[10px] font-bold tracking-wider text-neutral-400 uppercase hover:text-neutral-950"
          >
            ← Back to orders
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            Order CF-{order.orderId.slice(0, 8).toUpperCase()}
          </h1>
          <div className="mt-3">
            <StatusBadge
              label={status.label}
              tone={status.tone}
              pulse={order.status === 'IN_PROGRESS'}
            />
          </div>
        </div>
        <div className="flex gap-2">
          {['PENDING', 'RESCHEDULED'].includes(order.status) && !order.driverId && (
            <Link
              to="/admin/dispatch"
              className="inline-flex h-10 items-center rounded-lg border border-neutral-200 bg-white px-4 text-xs font-bold"
            >
              Assign driver
            </Link>
          )}
          {order.status === 'ASSIGNED' && (
            <Button onClick={() => setConfirmStart(true)}>Start delivery</Button>
          )}
        </div>
      </div>
      {error && (
        <div className="mt-5">
          <ErrorState message={error} compact />
        </div>
      )}

      <section className="mt-8 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
          <DetailLocationMap
            destination={{
              position: [order.lat, order.lng],
              label: formatLocationInEnglish(order.dropoffAddress),
            }}
            driver={
              driver && driver.lat !== null && driver.lng !== null
                ? { position: [driver.lat, driver.lng], label: `${driver.name} · live location` }
                : null
            }
          />
          <div className="grid gap-px bg-neutral-200 sm:grid-cols-3">
            <Info label="Destination" value={formatLocationInEnglish(order.dropoffAddress)} />
            <Info label="Region" value={formatLocationInEnglish(order.region)} />
            <Info
              label="Coordinates"
              value={`${order.lat.toFixed(5)}, ${order.lng.toFixed(5)}`}
              mono
            />
          </div>
        </div>
        <div className="space-y-5">
          <Panel title="Customer information">
            <InfoRow label="Name" value={order.customerName} />
            <InfoRow label="Phone" value={order.customerPhone} />
            <InfoRow label="Order created" value={dateTime(order.createdAt)} />
          </Panel>
          <Panel title="Current driver">
            {driver ? (
              <Link
                to={`/admin/fleet/${driver.driverId}`}
                className="block rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-950"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold">{driver.name}</p>
                    <p className="mt-1 text-[10px] text-neutral-400">
                      {driver.driverId} · {driver.vehiclePlate}
                    </p>
                  </div>
                  <span>→</span>
                </div>
              </Link>
            ) : (
              <p className="text-xs text-neutral-400">No driver assigned.</p>
            )}
          </Panel>
          <Panel title="Customer notification">
            <StatusBadge
              label={
                !smsEvent
                  ? order.status === 'DELIVERED'
                    ? 'Awaiting notification record'
                    : 'Not triggered'
                  : smsEvent.type === 'SMS_NOTIFICATION_SENT'
                    ? 'SMS accepted by Twilio'
                    : 'SMS delivery failed'
              }
              tone={
                !smsEvent
                  ? 'neutral'
                  : smsEvent.type === 'SMS_NOTIFICATION_SENT'
                    ? 'success'
                    : 'danger'
              }
            />
            <p className="mt-2 text-[10px] text-neutral-400">
              {smsEvent
                ? dateTime(smsEvent.occurredAt)
                : 'Triggered automatically after delivery completion.'}
            </p>
          </Panel>
          <Panel title="Operational actions">
            <div className="grid gap-2">
              <Button
                variant="secondary"
                className="w-full"
                isLoading={isCopyingTracking}
                onClick={() => void copyTrackingLink()}
              >
                Copy customer tracking link
              </Button>
              {['PENDING', 'RESCHEDULED'].includes(order.status) && !order.driverId && (
                <ActionLink to="/admin/dispatch" label="Assign a driver" />
              )}
              {order.status === 'ASSIGNED' && (
                <Button className="w-full" onClick={() => setConfirmStart(true)}>
                  Start delivery
                </Button>
              )}
              {['IN_PROGRESS', 'ARRIVED'].includes(order.status) && (
                <Button
                  variant="secondary"
                  className="w-full"
                  isLoading={isUpdatingStatus}
                  onClick={() => void changeStatus('DELIVERY_FAILED')}
                >
                  Report delivery failure
                </Button>
              )}
              {['PENDING', 'ASSIGNED', 'IN_PROGRESS'].includes(order.status) && (
                <Button
                  variant="secondary"
                  className="w-full"
                  isLoading={isUpdatingStatus}
                  onClick={() => void changeStatus('CANCELLED')}
                >
                  Cancel order
                </Button>
              )}
              {order.status === 'DELIVERY_FAILED' && (
                <>
                  <Button
                    className="w-full"
                    isLoading={isUpdatingStatus}
                    onClick={() => void changeStatus('RESCHEDULED')}
                  >
                    Reschedule delivery
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    isLoading={isUpdatingStatus}
                    onClick={() => void changeStatus('RETURNING')}
                  >
                    Start return
                  </Button>
                </>
              )}
              {order.status === 'RETURNING' && (
                <Button
                  className="w-full"
                  isLoading={isUpdatingStatus}
                  onClick={() => void changeStatus('RETURNED')}
                >
                  Confirm returned
                </Button>
              )}
              {driver && (
                <ActionLink to={`/admin/fleet/${driver.driverId}`} label="Open driver profile" />
              )}
              {proofUrl && (
                <a
                  href={proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-between rounded-lg border border-neutral-200 px-4 text-xs font-bold transition hover:border-neutral-950"
                >
                  View original proof <span aria-hidden="true">↗</span>
                </a>
              )}
              {['IN_PROGRESS', 'ARRIVED'].includes(order.status) && (
                <p className="rounded-lg bg-neutral-50 p-3 text-[10px] leading-4 text-neutral-500">
                  Completion remains in the driver workflow and requires arrival plus a registered
                  proof image.
                </p>
              )}
              {order.exception && (
                <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-[10px] leading-4 text-red-700">
                  {order.exception.reason.replaceAll('_', ' ')}
                  {order.exception.notes ? ` — ${order.exception.notes}` : ''}
                </p>
              )}
              {order.customerRescheduleRequest && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-800">
                  Customer requested{' '}
                  {dateTime(order.customerRescheduleRequest.requestedWindowStart)}–
                  {dateTime(order.customerRescheduleRequest.requestedWindowEnd)}
                  {order.customerRescheduleRequest.notes
                    ? ` — ${order.customerRescheduleRequest.notes}`
                    : ''}
                </p>
              )}
            </div>
          </Panel>
        </div>
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <Panel title="Lifecycle timestamps">
          <InfoRow label="Created" value={dateTime(order.createdAt)} />
          <InfoRow label="Assigned" value={dateTime(timestamps.assigned)} />
          <InfoRow label="Started" value={dateTime(timestamps.started)} />
          <InfoRow label="Delivered" value={dateTime(order.deliveredAt)} />
        </Panel>
        <Panel title="Status timeline">
          {events.length ? (
            <div className="space-y-0">
              {events.map((event, index) => (
                <div key={event.eventId} className="grid grid-cols-[auto_1fr] gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`mt-1 size-2 rounded-full ${event.type.includes('FAILED') ? 'bg-red-500' : event.type.includes('COMPLETED') || event.type.includes('SENT') ? 'bg-emerald-500' : 'bg-neutral-950'}`}
                    />
                    {index < events.length - 1 && <span className="h-full w-px bg-neutral-200" />}
                  </div>
                  <div className="pb-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold">{eventLabels[event.type]}</p>
                      <time className="text-[9px] text-neutral-400">
                        {dateTime(event.occurredAt)}
                      </time>
                    </div>
                    <p className="mt-1 text-[10px] text-neutral-400">
                      {event.source === 'DERIVED'
                        ? 'Derived from legacy order snapshot'
                        : `Recorded by ${event.actorId}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No timeline events"
              description="New operational changes will appear here."
              className="border-0"
            />
          )}
        </Panel>
      </section>

      <section className="mt-6">
        <Panel title="Proof of Delivery">
          {proof ? (
            <div className="grid gap-5 sm:grid-cols-[12rem_1fr]">
              {proofUrl ? (
                <a
                  href={proofUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100"
                >
                  <img
                    src={proofUrl}
                    alt="Proof of Delivery"
                    className="aspect-square h-full w-full object-cover"
                  />
                </a>
              ) : (
                <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 text-xs text-neutral-400">
                  Preview unavailable
                </div>
              )}
              <div>
                <InfoRow label="Uploaded" value={dateTime(proof.uploadedAt)} />
                <InfoRow label="Uploaded by" value={proof.uploadedBy} />
                <InfoRow label="Received by" value={proof.recipientName ?? 'Not recorded'} />
                <InfoRow
                  label="Signature"
                  value={proof.signatureDataUrl ? 'Captured' : 'Not captured'}
                />
                <InfoRow label="Barcode" value={proof.barcode ?? 'Not recorded'} />
                <InfoRow
                  label="GPS"
                  value={
                    proof.gps
                      ? `${proof.gps.lat.toFixed(5)}, ${proof.gps.lng.toFixed(5)} (±${Math.round(proof.gps.accuracy ?? 0)} m)`
                      : 'Not recorded'
                  }
                />
                <InfoRow label="Notes" value={proof.notes ?? 'None'} />
                <InfoRow label="File type" value={proof.contentType} />
                <InfoRow label="Size" value={`${(proof.size / 1024).toFixed(1)} KB`} />
              </div>
            </div>
          ) : (
            <EmptyState
              title="No Proof of Delivery"
              description={
                order.status === 'ARRIVED'
                  ? 'The driver must upload a photo before completing this delivery.'
                  : 'No proof metadata is associated with this order.'
              }
              className="border-0"
            />
          )}
        </Panel>
      </section>

      <ConfirmDialog
        isOpen={confirmStart}
        onClose={() => setConfirmStart(false)}
        onConfirm={() => void startDelivery()}
        isLoading={isStarting}
        title="Start this delivery?"
        description="The order will move to In transit and become active in the driver workspace."
        confirmLabel="Start delivery"
      />
    </main>
  );
};

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
    <h2 className="mb-5 text-sm font-bold">{title}</h2>
    {children}
  </section>
);
const Info = ({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) => (
  <div className="bg-white p-4">
    <p className="text-[8px] font-bold tracking-wider text-neutral-400 uppercase">{label}</p>
    <p className={`mt-2 text-[11px] leading-5 ${mono ? 'font-mono' : 'font-semibold'}`}>{value}</p>
  </div>
);
const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between gap-5 border-b border-neutral-100 py-3 first:pt-0 last:border-0 last:pb-0">
    <span className="text-[10px] text-neutral-400">{label}</span>
    <span className="text-right text-[11px] font-semibold">{value}</span>
  </div>
);
const ActionLink = ({ to, label }: { to: string; label: string }) => (
  <Link
    to={to}
    className="inline-flex h-10 items-center justify-between rounded-lg border border-neutral-200 px-4 text-xs font-bold transition hover:border-neutral-950"
  >
    {label}
    <span aria-hidden="true">→</span>
  </Link>
);
