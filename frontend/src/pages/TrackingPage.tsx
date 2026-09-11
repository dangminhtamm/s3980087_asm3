import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { BrandMark } from '../components/BrandMark';
import { DetailLocationMap } from '../components/admin/DetailLocationMap';
import { ErrorState, PageSkeleton } from '../components/ui';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import {
  getPublicTracking,
  requestCustomerReschedule,
  submitCustomerFeedback,
} from '../services/tracking';
import type { OrderEventType } from '../types/admin';
import type { PublicTrackingData } from '../types/tracking';
import { formatLocationInEnglish } from '../utils/location';

const TRACKING_REFRESH_MS = 12_000;
const milestoneTypes: OrderEventType[] = [
  'ORDER_CREATED',
  'DRIVER_ASSIGNED',
  'DELIVERY_STARTED',
  'DRIVER_ARRIVED',
  'PROOF_UPLOADED',
  'DELIVERY_COMPLETED',
];
const milestoneLabels: Partial<Record<OrderEventType, string>> = {
  ORDER_CREATED: 'Order received',
  DRIVER_ASSIGNED: 'Driver assigned',
  DELIVERY_STARTED: 'Out for delivery',
  DRIVER_ARRIVED: 'Driver arrived',
  PROOF_UPLOADED: 'Delivery proof secured',
  DELIVERY_COMPLETED: 'Delivered',
};

const dateTime = (value: string): string =>
  new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

const errorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error?.message;
    if (typeof message === 'string') return message;
  }
  return 'We could not load this delivery. Check the link and try again.';
};

export const TrackingPage = () => {
  const { trackingToken } = useParams<{ trackingToken: string }>();
  const isOnline = useNetworkStatus();
  const [tracking, setTracking] = useState<PublicTrackingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleEnd, setRescheduleEnd] = useState('');
  const [rescheduleNotes, setRescheduleNotes] = useState('');
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!trackingToken) {
        setError('This tracking link is incomplete.');
        setIsLoading(false);
        return;
      }
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        setTracking(await getPublicTracking(trackingToken));
        setError(null);
      } catch (loadError: unknown) {
        setError(errorMessage(loadError));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [trackingToken],
  );

  useEffect(() => {
    document.title = 'Track your delivery · CloudFleet';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow, noarchive';
    document.head.append(robots);
    void load();
    const timer = window.setInterval(() => {
      if (navigator.onLine) void load(true);
    }, TRACKING_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      robots.remove();
    };
  }, [load]);

  const milestones = useMemo(() => {
    if (!tracking) return [];
    return milestoneTypes.map((type) => ({
      type,
      label: milestoneLabels[type] ?? type,
      event: tracking.timeline.find((entry) => entry.type === type) ?? null,
    }));
  }, [tracking]);

  const submitFeedback = async () => {
    if (!trackingToken || rating < 1) return;
    setFeedbackBusy(true);
    setActionMessage(null);
    try {
      const feedback = await submitCustomerFeedback(trackingToken, {
        rating,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setTracking((current) => (current ? { ...current, feedback } : current));
      setActionMessage('Thank you—your feedback was recorded.');
    } catch (submitError: unknown) {
      setActionMessage(errorMessage(submitError));
    } finally {
      setFeedbackBusy(false);
    }
  };

  const requestReschedule = async () => {
    if (!trackingToken || !rescheduleStart || !rescheduleEnd) return;
    setRescheduleBusy(true);
    setActionMessage(null);
    try {
      const rescheduleRequest = await requestCustomerReschedule(trackingToken, {
        requestedWindowStart: new Date(rescheduleStart).toISOString(),
        requestedWindowEnd: new Date(rescheduleEnd).toISOString(),
        ...(rescheduleNotes.trim() ? { notes: rescheduleNotes.trim() } : {}),
      });
      setTracking((current) => (current ? { ...current, rescheduleRequest } : current));
      setActionMessage('Your request was sent to the operations team for confirmation.');
    } catch (submitError: unknown) {
      setActionMessage(errorMessage(submitError));
    } finally {
      setRescheduleBusy(false);
    }
  };

  if (isLoading)
    return (
      <main className="min-h-screen bg-neutral-50 px-5 py-10">
        <div className="mx-auto max-w-5xl">
          <PageSkeleton />
        </div>
      </main>
    );
  if (!tracking)
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-50 px-5">
        <div className="w-full max-w-lg">
          <ErrorState
            title="Tracking unavailable"
            message={error ?? 'This tracking link is invalid or expired.'}
            onRetry={() => void load()}
          />
        </div>
      </main>
    );

  const isDelivered = tracking.status === 'DELIVERED';
  const exceptionCopy = {
    DELIVERY_FAILED: {
      eyebrow: 'Delivery exception',
      title: 'We could not complete this delivery.',
      detail: 'The operations team is reviewing the next step.',
    },
    RESCHEDULED: {
      eyebrow: 'Delivery rescheduled',
      title: 'Your delivery will be attempted again.',
      detail: 'A new driver or delivery time will be assigned shortly.',
    },
    CANCELLED: {
      eyebrow: 'Order cancelled',
      title: 'This delivery has been cancelled.',
      detail: 'Contact the sender if you need more information.',
    },
    RETURNING: {
      eyebrow: 'Returning to sender',
      title: 'The parcel is being returned.',
      detail: 'This delivery could not be completed.',
    },
    RETURNED: {
      eyebrow: 'Returned to sender',
      title: 'The parcel has been returned.',
      detail: 'Contact the sender if another delivery is required.',
    },
  } as const;
  const statusCopy = isDelivered
    ? {
        eyebrow: 'Delivery completed',
        title: 'Your order has arrived.',
        detail: tracking.deliveredAt
          ? `Delivered ${dateTime(tracking.deliveredAt)}`
          : 'Delivered successfully',
      }
    : tracking.status in exceptionCopy
      ? exceptionCopy[tracking.status as keyof typeof exceptionCopy]
      : tracking.status === 'ARRIVED'
        ? {
            eyebrow: 'Driver arrived',
            title: 'Your delivery is at the destination.',
            detail: 'The driver is completing the handoff and proof.',
          }
        : tracking.status === 'IN_PROGRESS'
          ? tracking.driverApproaching
            ? {
                eyebrow: 'Driver approaching',
                title: 'Your delivery is almost there.',
                detail: tracking.estimatedArrivalMinutes
                  ? `Approximately ${tracking.estimatedArrivalMinutes} minutes away`
                  : 'Approaching your destination',
              }
            : {
                eyebrow: 'Out for delivery',
                title: 'Your order is on the move.',
                detail: tracking.estimatedArrivalMinutes
                  ? `Estimated arrival in ${tracking.estimatedArrivalMinutes} minutes`
                  : 'Live location will appear when available',
              }
          : tracking.driver
            ? {
                eyebrow: 'Driver assigned',
                title: 'Your delivery is being prepared.',
                detail: 'We will update this page when the driver starts the route.',
              }
            : {
                eyebrow: 'Order confirmed',
                title: 'We are preparing your delivery.',
                detail: 'A driver will be assigned shortly.',
              };
  const driverPosition =
    ['IN_PROGRESS', 'ARRIVED'].includes(tracking.status) &&
    tracking.driver?.lat !== null &&
    tracking.driver?.lat !== undefined &&
    tracking.driver.lng !== null
      ? ([tracking.driver.lat, tracking.driver.lng] as [number, number])
      : null;

  return (
    <main className="min-h-screen bg-[#f5f5f3] text-neutral-950">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <BrandMark />
          <div className="flex items-center gap-2 text-[10px] font-semibold text-neutral-500">
            <span
              className={`size-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`}
            />
            {isOnline ? (isRefreshing ? 'Updating location…' : 'Live tracking') : 'Offline'}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        {error && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            Latest update could not be loaded. Showing the most recent information.
          </div>
        )}
        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_22px_70px_rgba(10,10,10,0.07)]">
          <div className="grid lg:grid-cols-[0.82fr_1.18fr]">
            <div className="flex flex-col justify-between p-7 sm:p-10 lg:min-h-[31rem]">
              <div>
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[10px] font-bold tracking-[0.18em] text-neutral-400 uppercase">
                    {statusCopy.eyebrow}
                  </p>
                  <span className="font-mono text-[10px] text-neutral-400">
                    {tracking.reference}
                  </span>
                </div>
                <h1 className="mt-7 max-w-lg text-4xl font-semibold tracking-[-0.055em] sm:text-6xl">
                  {statusCopy.title}
                </h1>
                <p className="mt-5 text-sm leading-6 text-neutral-500">{statusCopy.detail}</p>
              </div>
              <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-neutral-200 ring-1 ring-neutral-200">
                <Info
                  label="Estimated arrival"
                  value={
                    isDelivered
                      ? 'Arrived'
                      : tracking.estimatedArrivalMinutes
                        ? `${tracking.estimatedArrivalMinutes} min`
                        : 'Calculating'
                  }
                />
                <Info
                  label="Distance remaining"
                  value={
                    isDelivered
                      ? '0 km'
                      : tracking.distanceRemainingKm === null
                        ? 'Waiting for GPS'
                        : tracking.distanceRemainingKm < 1
                          ? `${Math.round(tracking.distanceRemainingKm * 1000)} m`
                          : `${tracking.distanceRemainingKm.toFixed(1)} km`
                  }
                />
              </div>
            </div>
            <div className="relative min-h-[26rem] border-t border-neutral-200 bg-neutral-100 lg:border-t-0 lg:border-l">
              <DetailLocationMap
                destination={{
                  position: [tracking.destination.lat, tracking.destination.lng],
                  label: formatLocationInEnglish(tracking.destination.address),
                }}
                driver={
                  driverPosition && tracking.driver
                    ? { position: driverPosition, label: `${tracking.driver.name} · live location` }
                    : null
                }
              />
              {!isDelivered && tracking.status === 'IN_PROGRESS' && (
                <div className="pointer-events-none absolute right-5 bottom-5 left-5 z-[500] rounded-2xl border border-white/70 bg-white/92 p-4 shadow-xl backdrop-blur sm:left-auto sm:w-80">
                  <div className="flex items-center gap-3">
                    <span
                      className={`size-2 rounded-full ${tracking.driverApproaching ? 'animate-pulse bg-emerald-500' : 'bg-amber-500'}`}
                    />
                    <div>
                      <p className="text-xs font-bold">
                        {tracking.driverApproaching ? 'Driver approaching' : 'Driver en route'}
                      </p>
                      <p className="mt-1 text-[10px] text-neutral-500">
                        Location automatically refreshes every 12 seconds.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
            <p className="text-[9px] font-bold tracking-[0.18em] text-neutral-400 uppercase">
              Delivery progress
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">Timeline</h2>
            <ol className="mt-7">
              {milestones.map((milestone, index) => {
                const complete = Boolean(milestone.event);
                return (
                  <li key={milestone.type} className="grid grid-cols-[auto_1fr] gap-4">
                    <div className="flex flex-col items-center">
                      <span
                        className={`mt-1.5 size-2.5 rounded-full border-2 ${complete ? 'border-neutral-950 bg-neutral-950' : 'border-neutral-300 bg-white'}`}
                      />
                      {index < milestones.length - 1 && (
                        <span
                          className={`min-h-12 w-px grow ${complete ? 'bg-neutral-950' : 'bg-neutral-200'}`}
                        />
                      )}
                    </div>
                    <div className="pb-7">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p
                          className={`text-xs font-bold ${complete ? 'text-neutral-950' : 'text-neutral-400'}`}
                        >
                          {milestone.label}
                        </p>
                        <time className="text-[9px] text-neutral-400">
                          {milestone.event ? dateTime(milestone.event.occurredAt) : 'Pending'}
                        </time>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <div className="space-y-6">
            <section className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
              <p className="text-[9px] font-bold tracking-[0.18em] text-neutral-400 uppercase">
                Destination
              </p>
              <h2 className="mt-3 text-lg font-semibold tracking-tight">
                {formatLocationInEnglish(tracking.destination.address)}
              </h2>
              <p className="mt-2 text-xs text-neutral-400">
                {formatLocationInEnglish(tracking.destination.region)}
              </p>
            </section>
            {tracking.driver && (
              <section className="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
                <p className="text-[9px] font-bold tracking-[0.18em] text-neutral-400 uppercase">
                  Your driver
                </p>
                <div className="mt-4 flex items-center gap-4">
                  <span className="grid size-12 place-items-center rounded-full bg-neutral-950 text-sm font-bold text-white">
                    {tracking.driver.name
                      .split(/\s+/)
                      .map((part) => part[0])
                      .slice(-2)
                      .join('')}
                  </span>
                  <div>
                    <h2 className="text-sm font-bold">{tracking.driver.name}</h2>
                    <p className="mt-1 text-[10px] text-neutral-400">
                      Vehicle {tracking.driver.vehiclePlate}
                    </p>
                  </div>
                </div>
              </section>
            )}
            <section
              className={`rounded-2xl border p-6 sm:p-8 ${isDelivered && tracking.proof.confirmed ? 'border-emerald-200 bg-emerald-50' : 'border-neutral-200 bg-white'}`}
            >
              <div className="flex gap-4">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full text-lg ${isDelivered && tracking.proof.confirmed ? 'bg-emerald-600 text-white' : 'bg-neutral-100 text-neutral-400'}`}
                >
                  {isDelivered && tracking.proof.confirmed ? '✓' : '○'}
                </span>
                <div>
                  <p className="text-[9px] font-bold tracking-[0.18em] text-neutral-400 uppercase">
                    Proof confirmation
                  </p>
                  <h2 className="mt-2 text-sm font-bold">
                    {tracking.proof.confirmed
                      ? 'Proof of Delivery secured'
                      : 'Available after delivery'}
                  </h2>
                  <p className="mt-2 text-[10px] leading-4 text-neutral-500">
                    {tracking.proof.uploadedAt
                      ? `Confirmed ${dateTime(tracking.proof.uploadedAt)}${tracking.proof.recipientName ? ` · received by ${tracking.proof.recipientName}` : ''}${tracking.proof.signatureCaptured ? ' · signature captured' : ''}`
                      : 'Your driver will capture confirmation at the destination.'}
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>

        {actionMessage && (
          <div
            role="status"
            className="mt-6 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-700"
          >
            {actionMessage}
          </div>
        )}

        {isDelivered ? (
          <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
            <p className="text-[9px] font-bold tracking-[0.18em] text-neutral-400 uppercase">
              Delivery feedback
            </p>
            {tracking.feedback ? (
              <div className="mt-4">
                <p className="text-2xl tracking-widest text-amber-500">
                  {'★'.repeat(tracking.feedback.rating)}
                  <span className="text-neutral-200">
                    {'★'.repeat(5 - tracking.feedback.rating)}
                  </span>
                </p>
                <p className="mt-2 text-xs text-neutral-500">
                  Feedback received {dateTime(tracking.feedback.submittedAt)}.
                </p>
              </div>
            ) : (
              <div className="mt-4">
                <div className="flex gap-2" aria-label="Delivery rating">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRating(value)}
                      aria-label={`${value} stars`}
                      className={`text-3xl ${value <= rating ? 'text-amber-500' : 'text-neutral-200'}`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Tell us about your delivery (optional)"
                  className="mt-4 w-full rounded-xl border border-neutral-200 p-3 text-xs outline-none focus:border-neutral-950"
                />
                <button
                  type="button"
                  disabled={rating < 1 || feedbackBusy || !isOnline}
                  onClick={() => void submitFeedback()}
                  className="mt-3 h-10 rounded-lg bg-neutral-950 px-5 text-xs font-bold text-white disabled:opacity-40"
                >
                  {feedbackBusy ? 'Sending…' : 'Submit feedback'}
                </button>
              </div>
            )}
          </section>
        ) : ['PENDING', 'ASSIGNED'].includes(tracking.status) ? (
          <section className="mt-6 rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8">
            <p className="text-[9px] font-bold tracking-[0.18em] text-neutral-400 uppercase">
              Need a different time?
            </p>
            {tracking.rescheduleRequest ? (
              <div className="mt-4 rounded-xl bg-amber-50 p-4">
                <p className="text-xs font-bold text-amber-900">
                  Reschedule request pending review
                </p>
                <p className="mt-1 text-[10px] text-amber-800">
                  Requested {dateTime(tracking.rescheduleRequest.requestedWindowStart)}–
                  {dateTime(tracking.rescheduleRequest.requestedWindowEnd)}.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-[10px] font-bold text-neutral-500">
                  From
                  <input
                    type="datetime-local"
                    value={rescheduleStart}
                    onChange={(event) => setRescheduleStart(event.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-neutral-200 px-3 text-xs"
                  />
                </label>
                <label className="text-[10px] font-bold text-neutral-500">
                  Until
                  <input
                    type="datetime-local"
                    value={rescheduleEnd}
                    onChange={(event) => setRescheduleEnd(event.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-neutral-200 px-3 text-xs"
                  />
                </label>
                <textarea
                  value={rescheduleNotes}
                  onChange={(event) => setRescheduleNotes(event.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Access notes or preferred timing (optional)"
                  className="sm:col-span-2 w-full rounded-xl border border-neutral-200 p-3 text-xs outline-none focus:border-neutral-950"
                />
                <button
                  type="button"
                  disabled={!rescheduleStart || !rescheduleEnd || rescheduleBusy || !isOnline}
                  onClick={() => void requestReschedule()}
                  className="h-10 rounded-lg bg-neutral-950 px-5 text-xs font-bold text-white disabled:opacity-40"
                >
                  {rescheduleBusy ? 'Sending…' : 'Request reschedule'}
                </button>
              </div>
            )}
          </section>
        ) : null}

        <footer className="mt-10 flex flex-col gap-2 border-t border-neutral-300 pt-6 text-[9px] text-neutral-400 sm:flex-row sm:justify-between">
          <p>CloudFleet customer tracking</p>
          <p>This private link expires {dateTime(tracking.trackingExpiresAt)}.</p>
        </footer>
      </div>
    </main>
  );
};

const Info = ({ label, value }: { label: string; value: string }) => (
  <div className="bg-neutral-50 p-4">
    <p className="text-[8px] font-bold tracking-[0.13em] text-neutral-400 uppercase">{label}</p>
    <p className="mt-2 text-xs font-bold text-neutral-950">{value}</p>
  </div>
);
