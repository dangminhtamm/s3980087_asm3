import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { ErrorState, PageSkeleton } from '../components/ui';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import {
  getPublicTracking,
  requestCustomerReschedule,
  submitCustomerFeedback,
} from '../features/tracking/api/tracking.client';
import type { OrderEventType } from '../types/admin';
import type { PublicTrackingData } from '../types/tracking';
import { TrackingView } from '../features/tracking/components/TrackingView';

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
    <TrackingView
      tracking={tracking}
      isOnline={isOnline}
      isRefreshing={isRefreshing}
      error={error}
      milestones={milestones}
      statusCopy={statusCopy}
      driverPosition={driverPosition}
      actionMessage={actionMessage}
      rating={rating}
      comment={comment}
      feedbackBusy={feedbackBusy}
      rescheduleStart={rescheduleStart}
      rescheduleEnd={rescheduleEnd}
      rescheduleNotes={rescheduleNotes}
      rescheduleBusy={rescheduleBusy}
      setRating={setRating}
      setComment={setComment}
      setRescheduleStart={setRescheduleStart}
      setRescheduleEnd={setRescheduleEnd}
      setRescheduleNotes={setRescheduleNotes}
      submitFeedback={submitFeedback}
      requestReschedule={requestReschedule}
    />
  );
};
