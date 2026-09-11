import type { ReactNode } from 'react';

import type {
  DriverLocationTracking,
  TrackingStatus,
} from '../../../hooks/useDriverLocationTracking';
import type { DeliveryOrder } from '../../../types/order';
import { formatLocationFreshness } from '../../../utils/geo';
import type { DeliveryFeedback } from '../model/delivery.types';
import { OfflineIcon } from './DeliveryIcons';

const STEPS = ['View', 'Start', 'Arrive', 'Capture', 'Review', 'Upload', 'Confirm', 'Complete'];

export const WorkflowProgress = ({ currentStep }: { currentStep: number }) => (
  <ol
    aria-label="Delivery workflow"
    className="mt-6 grid grid-cols-4 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-8"
  >
    {STEPS.map((label, index) => {
      const number = index + 1;
      const complete = number < currentStep;
      const active = number === currentStep;
      return (
        <li
          key={label}
          className={`min-w-0 bg-white px-2 py-3 text-center ${active ? 'bg-slate-950 text-white' : ''}`}
        >
          <span
            className={`mx-auto grid size-5 place-items-center rounded-full text-[9px] font-black ${complete ? 'bg-emerald-500 text-white' : active ? 'bg-white text-slate-950' : 'bg-slate-100 text-slate-400'}`}
          >
            {complete ? '✓' : number}
          </span>
          <span
            className={`mt-1.5 block truncate text-[8px] font-bold uppercase ${!active && !complete ? 'text-slate-400' : ''}`}
          >
            {label}
          </span>
        </li>
      );
    })}
  </ol>
);

export const OfflineBanner = () => (
  <div
    role="status"
    className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-900"
  >
    <OfflineIcon />
    <p>
      Offline mode. Route events and GPS are queued on this device; proof photos and signatures
      remain here until upload is possible.
    </p>
  </div>
);

export const NextDeliveryPreview = ({ order }: { order: DeliveryOrder }) => (
  <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[9px] font-bold tracking-[0.18em] text-slate-400 uppercase">
          Next delivery
        </p>
        <p className="mt-2 text-sm font-black">{order.customerName}</p>
        <p className="mt-1 truncate text-xs text-slate-500">{order.dropoffAddress}</p>
      </div>
      <span className="shrink-0 font-mono text-[9px] font-bold text-slate-400">
        CF-{order.orderId.slice(0, 8).toUpperCase()}
      </span>
    </div>
  </section>
);

export const LocationPermissionCard = ({
  tracking,
  active,
}: {
  tracking: DriverLocationTracking;
  active: boolean;
}) => {
  const labels: Record<TrackingStatus, { title: string; detail: string; tone: string }> = {
    idle: {
      title: 'Location inactive',
      detail: 'Location sharing begins after Start route.',
      tone: 'bg-slate-400',
    },
    requesting: {
      title: 'Location permission required',
      detail: 'Approve the browser prompt to share live route progress.',
      tone: 'bg-amber-500',
    },
    tracking: {
      title: 'Live location enabled',
      detail: formatLocationFreshness(tracking.lastUpdatedAt),
      tone: 'bg-emerald-500',
    },
    denied: {
      title: 'Location permission denied',
      detail: 'Enable location for this site in browser settings, then retry.',
      tone: 'bg-red-500',
    },
    unsupported: {
      title: 'Location unavailable',
      detail: 'This browser does not support geolocation.',
      tone: 'bg-red-500',
    },
    error: {
      title: 'Location update failed',
      detail: 'Check device location services and network connectivity.',
      tone: 'bg-red-500',
    },
  };
  const state = labels[active ? tracking.status : 'idle'];
  return (
    <div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <span className={`size-2 shrink-0 rounded-full ${state.tone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold">{state.title}</p>
        <p className="mt-0.5 text-[10px] text-slate-500">{state.detail}</p>
      </div>
      {(tracking.status === 'denied' || tracking.status === 'error') && active && (
        <button
          type="button"
          onClick={() => void tracking.retry()}
          className="text-[10px] font-bold text-teal-700"
        >
          Retry
        </button>
      )}
    </div>
  );
};

export const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-slate-50 p-3">
    <p className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
    <p className="mt-1 text-sm font-black">{value}</p>
  </div>
);
export const OrderField = ({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) => (
  <div className="flex gap-3">
    <span className="mt-0.5 text-slate-400">{icon}</span>
    <div>
      <p className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
      <p className="mt-1 text-sm font-bold leading-5">{value}</p>
    </div>
  </div>
);
export const FeedbackBanner = ({ feedback }: { feedback: Exclude<DeliveryFeedback, null> }) => (
  <div
    role={feedback.type === 'error' ? 'alert' : 'status'}
    className={`mt-4 rounded-xl border p-3 text-xs font-semibold ${feedback.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}
  >
    {feedback.message}
  </div>
);
