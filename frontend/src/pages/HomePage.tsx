import { Link } from 'react-router-dom';

import { AppIcon } from '../components/AppIcon';
import { BrandMark } from '../components/BrandMark';

const workspaces = [
  {
    to: '/admin',
    label: 'Admin Console',
    description: 'Dispatch orders, manage the fleet and monitor operational performance.',
    icon: 'overview' as const,
    meta: 'Operations & analytics',
  },
  {
    to: '/driver',
    label: 'Driver App',
    description: 'Accept assignments, view routes and confirm deliveries from any device.',
    icon: 'route' as const,
    meta: 'Delivery workspace',
  },
];

export const HomePage = () => (
  <main className="min-h-screen bg-neutral-950 text-white">
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
      <header className="flex items-center justify-between border-b border-white/10 pb-6">
        <BrandMark inverse />
        <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-neutral-500 uppercase">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          Platform online
        </div>
      </header>

      <section className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
        <div>
          <p className="text-[10px] font-bold tracking-[0.24em] text-neutral-500 uppercase">
            CloudFleet / Logistics OS
          </p>
          <h1 className="mt-7 max-w-3xl text-5xl font-semibold tracking-[-0.065em] sm:text-6xl lg:text-7xl">
            Every delivery.
            <br />
            One clear view.
          </h1>
          <p className="mt-7 max-w-xl text-sm leading-7 text-neutral-400">
            A real-time delivery operations platform for CloudFleet dispatchers and drivers.
          </p>
        </div>

        <div className="border border-white/12 bg-white/[0.03] p-2">
          {workspaces.map((workspace, index) => (
            <Link
              key={workspace.to}
              to={workspace.to}
              className={`group flex items-center gap-5 p-5 transition hover:bg-white/[0.06] sm:p-7 ${index > 0 ? 'border-t border-white/10' : ''}`}
            >
              <span className="flex size-12 shrink-0 items-center justify-center border border-white/15 text-neutral-300 transition group-hover:bg-white group-hover:text-neutral-950">
                <AppIcon name={workspace.icon} className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-[9px] font-bold tracking-[0.18em] text-neutral-600 uppercase">
                  {workspace.meta}
                </span>
                <span className="mt-1 block text-lg font-semibold tracking-tight">
                  {workspace.label}
                </span>
                <span className="mt-2 block text-xs leading-5 text-neutral-500">
                  {workspace.description}
                </span>
              </span>
              <AppIcon
                name="arrow"
                className="size-4 text-neutral-600 transition group-hover:translate-x-1 group-hover:text-white"
              />
            </Link>
          ))}
        </div>
      </section>

      <footer className="flex flex-col gap-2 border-t border-white/10 pt-5 text-[10px] text-neutral-600 sm:flex-row sm:justify-between">
        <span>CloudFleet Platform · 2026</span>
        <span>Built for fast-moving operations</span>
      </footer>
    </div>
  </main>
);
