import type { AdminOrder } from '../../types/admin';
import { formatLocationInEnglish } from '../../utils/location';

export type ActivityKind = 'created' | 'assigned' | 'started' | 'proof' | 'completed';

export interface OperationalActivity {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  occurredAt: string;
}

const activityLabels: Record<ActivityKind, string> = {
  created: 'Order created',
  assigned: 'Driver assigned',
  started: 'Delivery started',
  proof: 'Proof uploaded',
  completed: 'Delivery completed',
};

const activityDots: Record<ActivityKind, string> = {
  created: 'bg-neutral-400',
  assigned: 'bg-blue-500',
  started: 'bg-amber-500',
  proof: 'bg-violet-500',
  completed: 'bg-emerald-500',
};

const timestampOffset = (timestamp: string, offsetMs: number): string =>
  new Date(new Date(timestamp).getTime() + offsetMs).toISOString();

/**
 * The current API exposes order snapshots rather than an audit stream. These
 * entries are therefore derived from state transitions. DynamoDB event items
 * can replace this builder later without changing the feed component.
 */
export const deriveRecentActivity = (orders: AdminOrder[]): OperationalActivity[] => {
  const activities = orders.flatMap<OperationalActivity>((order) => {
    const shortId = `CF-${order.orderId.slice(0, 8).toUpperCase()}`;
    const items: OperationalActivity[] = [
      {
        id: `${order.orderId}-created`,
        kind: 'created',
        title: activityLabels.created,
        detail: `${shortId} for ${order.customerName}`,
        occurredAt: order.createdAt,
      },
    ];

    if (order.driverId)
      items.push({
        id: `${order.orderId}-assigned`,
        kind: 'assigned',
        title: activityLabels.assigned,
        detail: `${order.driverId} assigned to ${shortId}`,
        occurredAt: timestampOffset(order.createdAt, 60_000),
      });
    if (
      ['IN_PROGRESS', 'ARRIVED', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNING', 'RETURNED'].includes(
        order.status,
      )
    )
      items.push({
        id: `${order.orderId}-started`,
        kind: 'started',
        title: activityLabels.started,
        detail: `${shortId} is moving to ${formatLocationInEnglish(order.region)}`,
        occurredAt: timestampOffset(order.createdAt, 2 * 60_000),
      });
    if (order.status === 'DELIVERED' && order.deliveredAt) {
      // The backend requires a registered proof before accepting DELIVERED.
      items.push({
        id: `${order.orderId}-proof`,
        kind: 'proof',
        title: activityLabels.proof,
        detail: `Proof of Delivery secured for ${shortId}`,
        occurredAt: timestampOffset(order.deliveredAt, -1_000),
      });
      items.push({
        id: `${order.orderId}-completed`,
        kind: 'completed',
        title: activityLabels.completed,
        detail: `${shortId} delivered successfully`,
        occurredAt: order.deliveredAt,
      });
    }
    return items;
  });

  return activities
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 12);
};

const relativeTime = (timestamp: string): string => {
  const seconds = Math.round((new Date(timestamp).getTime() - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
};

export const RecentActivityFeed = ({ activities }: { activities: OperationalActivity[] }) => (
  <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
    <header className="flex items-center justify-between border-b border-neutral-100 px-5 py-4 sm:px-6">
      <div>
        <h2 className="text-sm font-bold">Recent activity</h2>
        <p className="mt-1 text-[10px] text-neutral-400">Latest operational transitions</p>
      </div>
      <span className="text-[9px] font-bold tracking-wider text-neutral-400 uppercase">
        Derived live feed
      </span>
    </header>
    <div className="max-h-[28rem] divide-y divide-neutral-100 overflow-y-auto">
      {activities.map((activity) => (
        <article
          key={activity.id}
          className="group grid grid-cols-[auto_1fr_auto] items-start gap-3 px-5 py-4 transition hover:bg-neutral-50 sm:px-6"
        >
          <span
            className={`mt-1.5 size-2 rounded-full ring-4 ring-neutral-100 ${activityDots[activity.kind]}`}
          />
          <div>
            <p className="text-xs font-bold text-neutral-900">{activity.title}</p>
            <p className="mt-1 text-[11px] leading-4 text-neutral-500">{activity.detail}</p>
          </div>
          <time
            dateTime={activity.occurredAt}
            title={new Date(activity.occurredAt).toLocaleString('en-AU')}
            className="text-[9px] font-medium text-neutral-400"
          >
            {relativeTime(activity.occurredAt)}
          </time>
        </article>
      ))}
    </div>
  </section>
);
