import { NavLink, Outlet } from 'react-router-dom';

import { useCloudFleetAuth } from '../../auth/CloudFleetAuth';
import { AppIcon, type AppIconName } from '../AppIcon';
import { BrandMark } from '../BrandMark';
import { StatusBadge, useToast } from '../ui';

const navigation: ReadonlyArray<{ label: string; to: string; icon: AppIconName; end?: boolean }> = [
  { label: 'Overview', to: '/admin', icon: 'overview', end: true },
  { label: 'Dispatch', to: '/admin/dispatch', icon: 'dispatch' },
  { label: 'Fleet', to: '/admin/fleet', icon: 'fleet' },
  { label: 'Orders', to: '/admin/orders', icon: 'orders' },
  { label: 'Routes', to: '/admin/routes', icon: 'route' },
  { label: 'Exceptions', to: '/admin/exceptions', icon: 'bell' },
];

export const AdminLayout = () => {
  const auth = useCloudFleetAuth();
  const { toast } = useToast();
  const initials = auth.user?.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'CF';

  return (
  <div className="min-h-screen bg-[#f7f7f6] pb-18 text-neutral-950 lg:grid lg:grid-cols-[14.5rem_1fr] lg:pb-0">
    <aside className="hidden border-b border-neutral-200 bg-white lg:sticky lg:top-0 lg:block lg:h-screen lg:border-r lg:border-b-0">
      <div className="flex h-full flex-col">
        <div className="flex h-18 items-center justify-between border-b border-neutral-100 px-5 lg:px-6">
          <BrandMark />
          <span className="size-1.5 rounded-full bg-emerald-500 lg:hidden" />
        </div>

        <nav className="flex gap-1 overflow-x-auto px-4 py-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:px-3 lg:py-6">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-xs font-semibold transition ${
                  isActive
                    ? 'bg-neutral-950 text-white'
                    : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950'
                }`
              }
            >
              <AppIcon name={item.icon} />
              {item.label}
            </NavLink>
          ))}

          <div className="mx-2 my-3 hidden border-t border-neutral-100 lg:block" />

          <NavLink
            to="/admin/settings"
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-xs font-semibold transition ${
                isActive ? 'bg-neutral-950 text-white' : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950'
              }`
            }
          >
            <AppIcon name="settings" />
            Settings
          </NavLink>
        </nav>

        <div className="hidden border-t border-neutral-100 p-4 lg:block">
          <div className="flex items-center gap-3 px-2 py-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-bold">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">{auth.user?.displayName}</p>
              <p className="truncate text-[10px] text-neutral-400">Administrator</p>
            </div>
            {auth.isEnabled && (
              <button
                type="button"
                onClick={() => void auth.logout()}
                className="ml-auto text-[10px] font-semibold text-neutral-400 hover:text-neutral-950"
              >
                Logout
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>

    <div className="min-w-0">
      <header className="hidden h-18 items-center justify-between border-b border-neutral-200 bg-white/80 px-8 backdrop-blur lg:flex">
        <label className="flex w-full max-w-sm items-center gap-3 text-neutral-400">
          <AppIcon name="search" />
          <input
            type="search"
            aria-label="Search CloudFleet"
            placeholder="Search orders, drivers, vehicles..."
            className="w-full bg-transparent text-xs text-neutral-800 outline-none placeholder:text-neutral-400"
          />
        </label>
          <div className="flex items-center gap-6">
          <button type="button" onClick={() => toast({ title: 'No new alerts', description: 'Operational notifications will appear here.', tone: 'info' })} className="relative text-neutral-500 transition hover:text-neutral-950" aria-label="Notifications">
            <AppIcon name="bell" className="size-4.5" />
          </button>
          <StatusBadge label="Systems operational" tone="success" pulse />
        </div>
      </header>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur lg:hidden">
        <BrandMark />
        <div className="flex items-center gap-3">
          <StatusBadge label="Online" tone="success" pulse />
          <button type="button" onClick={() => toast({ title: 'No new alerts', description: 'Your operation is running normally.', tone: 'info' })} aria-label="Notifications" className="flex size-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-600"><AppIcon name="bell" /></button>
        </div>
      </header>
      <Outlet />
    </div>

    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-neutral-200 bg-white/95 px-1 pb-[max(0.45rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden">
      {[...navigation, { label: 'Settings', to: '/admin/settings', icon: 'settings' as const }].map((item) => (
        <NavLink key={item.to} to={item.to} end={'end' in item ? item.end : undefined} className={({ isActive }) => `flex min-w-0 flex-col items-center gap-1 rounded-lg py-1.5 text-[9px] font-bold transition ${isActive ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400'}`}>
          <AppIcon name={item.icon} className="size-4.5" />
          <span className="max-w-full truncate">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  </div>
  );
};
