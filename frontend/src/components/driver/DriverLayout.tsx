import { NavLink, Outlet } from 'react-router-dom';

import { useCloudFleetAuth } from '../../auth/CloudFleetAuth';
import { runtimeEnv } from '../../config/runtime';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { AppIcon, type AppIconName } from '../AppIcon';
import { BrandMark } from '../BrandMark';
import { StatusBadge, useToast } from '../ui';

const driverNavigation: ReadonlyArray<{ label: string; to: string; icon: AppIconName; end?: boolean }> = [
  { label: 'Delivery', to: '/driver', icon: 'route', end: true },
  { label: 'History', to: '/driver/history', icon: 'history' },
  { label: 'Profile', to: '/driver/profile', icon: 'profile' },
];

const navigationClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold transition ${
    isActive ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-400 hover:bg-white/5 hover:text-white'
  }`;

export const DriverLayout = () => {
  const auth = useCloudFleetAuth();
  const { toast } = useToast();
  const isOnline = useNetworkStatus();
  const driverId = auth.user?.username || runtimeEnv('VITE_DRIVER_ID') || 'DRV-018';
  const initials = auth.user?.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'CF';
  const today = new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date());

  return (
  <div className="min-h-screen bg-[#f4f6f8] text-slate-950 lg:grid lg:grid-cols-[15rem_1fr]">
    <aside className="hidden h-screen border-r border-white/10 bg-slate-950 text-white lg:sticky lg:top-0 lg:flex lg:flex-col">
      <div className="flex h-20 items-center border-b border-white/10 px-6">
        <BrandMark inverse />
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-4">
        <p className="px-3 pb-3 pt-2 text-[9px] font-bold tracking-[0.2em] text-slate-600 uppercase">Driver workspace</p>
        {driverNavigation.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navigationClass}>
            <AppIcon name={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-teal-400 text-xs font-black text-slate-950">{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold">{auth.user?.displayName}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{driverId} · {isOnline ? 'Online' : 'Offline'}</p>
          </div>
          <span className="size-1.5 rounded-full bg-emerald-400" />
          {auth.isEnabled && (
            <button
              type="button"
              onClick={() => void auth.logout()}
              className="text-[10px] font-bold text-slate-500 hover:text-white"
            >
              Logout
            </button>
          )}
        </div>
      </div>
    </aside>

    <div className="min-w-0 pb-20 lg:pb-0">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/92 backdrop-blur lg:h-20">
        <div className="mx-auto flex h-17 max-w-7xl items-center justify-between px-4 sm:px-6 lg:h-full lg:px-8">
          <div className="lg:hidden"><BrandMark /></div>
          <div className="hidden lg:block">
            <p className="text-[10px] font-bold tracking-[0.17em] text-slate-400 uppercase">{today}</p>
            <p className="mt-1 text-sm font-bold text-slate-800">Hello, {auth.user?.displayName}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex"><StatusBadge label={isOnline ? 'Online' : 'Offline'} tone={isOnline ? 'success' : 'danger'} pulse={isOnline} /></span>
            <button type="button" onClick={() => toast({ title: 'You are all caught up', description: 'New delivery assignments will appear here.', tone: 'info' })} aria-label="Notifications" className="relative flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-slate-400">
              <AppIcon name="bell" />
            </button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>

    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-slate-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
      {driverNavigation.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `flex flex-col items-center gap-1 rounded-lg py-1.5 text-[10px] font-bold ${isActive ? 'text-slate-950' : 'text-slate-400'}`}
        >
          <AppIcon name={item.icon} className="size-5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  </div>
  );
};
