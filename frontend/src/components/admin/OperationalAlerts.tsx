import { Link } from 'react-router-dom';

export type AlertSeverity = 'critical' | 'warning' | 'notice';

export interface OperationalAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  to: string;
}

const alertStyle: Record<AlertSeverity, { dot: string; label: string }> = {
  critical: { dot: 'bg-red-500', label: 'Critical' },
  warning: { dot: 'bg-amber-500', label: 'Attention' },
  notice: { dot: 'bg-neutral-400', label: 'Notice' },
};

export const OperationalAlerts = ({ alerts }: { alerts: OperationalAlert[] }) => (
  <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-950 text-white">
    <header className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
      <div><h2 className="text-sm font-bold">Attention required</h2><p className="mt-1 text-[10px] text-neutral-500">Issues affecting today's operation</p></div>
      <span className="flex size-7 items-center justify-center rounded-full border border-white/15 text-[10px] font-bold">{alerts.length}</span>
    </header>
    <div className="divide-y divide-white/10">
      {alerts.length === 0 && <div className="px-6 py-12 text-center"><span className="mx-auto block size-2 rounded-full bg-emerald-400" /><p className="mt-4 text-xs font-bold">Operation is clear</p><p className="mt-1 text-[10px] text-neutral-500">No active alerts were detected.</p></div>}
      {alerts.slice(0, 6).map((alert) => (
        <Link key={alert.id} to={alert.to} className="group block px-5 py-4 transition hover:bg-white/[0.05] sm:px-6">
          <div className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${alertStyle[alert.severity].dot}`} /><span className="text-[9px] font-bold tracking-wider text-neutral-500 uppercase">{alertStyle[alert.severity].label}</span><span className="ml-auto text-neutral-600 transition group-hover:translate-x-0.5 group-hover:text-white">→</span></div>
          <p className="mt-2 text-xs font-bold">{alert.title}</p>
          <p className="mt-1 text-[10px] leading-4 text-neutral-500">{alert.detail}</p>
        </Link>
      ))}
    </div>
  </section>
);
