import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { DetailLocationMap } from '../../components/admin/DetailLocationMap';
import { Button, DataSourceBadge, EmptyState, ErrorState, PageSkeleton, StatusBadge, useToast } from '../../components/ui';
import { useDriverLocationStream } from '../../hooks/useDriverLocationStream';
import { getDriver, listOrders, updateDriverStatus } from '../../services/operations';
import type { AdminOrder, DriverLocation, DriverStatus, FleetDriver } from '../../types/admin';
import { formatLocationFreshness } from '../../utils/geo';
import { formatLocationInEnglish } from '../../utils/location';

const dateTime = (value: string | null): string => value
  ? new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : 'Not available';

const driverStatus = (status: DriverStatus): { label: string; tone: 'success' | 'warning' | 'neutral' } =>
  status === 'AVAILABLE' ? { label: 'Available', tone: 'success' } : status === 'ON_DELIVERY' ? { label: 'On delivery', tone: 'warning' } : { label: 'Offline', tone: 'neutral' };

export const FleetDetailPage = () => {
  const { driverId } = useParams<{ driverId: string }>();
  const { toast } = useToast();
  const [driver, setDriver] = useState<FleetDriver | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLocation = useCallback((location: DriverLocation) => {
    if (location.driverId !== driverId) return;
    setDriver((current) => current ? { ...current, lat: location.lat, lng: location.lng, locationUpdatedAt: location.recordedAt, updatedAt: location.recordedAt } : current);
  }, [driverId]);
  const realtimeStatus = useDriverLocationStream(handleLocation);

  const load = useCallback(async (silent = false) => {
    if (!driverId) return;
    if (!silent) setIsLoading(true);
    try {
      const [driverResult, ordersResult] = await Promise.all([getDriver(driverId), listOrders({ driverId, limit: 50 })]);
      setDriver(driverResult.data); setOrders(ordersResult.data);
      setIsFallback(driverResult.isFallback || ordersResult.isFallback); setError(null);
    } catch (loadError: unknown) {
      setError(axios.isAxiosError(loadError) ? loadError.response?.data?.error?.message ?? 'Unable to load this driver.' : 'Unable to load this driver.');
    } finally { setIsLoading(false); }
  }, [driverId]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 15_000); return () => window.clearInterval(timer); }, [load]);

  const currentAssignment = useMemo(() => orders.find((order) => ['IN_PROGRESS', 'ARRIVED', 'RETURNING', 'DELIVERY_FAILED'].includes(order.status)) ?? orders.find((order) => order.status === 'ASSIGNED') ?? null, [orders]);
  const history = useMemo(() => orders.filter((order) => order.status === 'DELIVERED').sort((a, b) => (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? '')).slice(0, 8), [orders]);

  const changeStatus = async (status: 'AVAILABLE' | 'OFFLINE') => {
    if (!driver) return;
    setIsUpdating(true);
    try {
      const result = await updateDriverStatus(driver.driverId, status);
      setDriver(result.data); setIsFallback((current) => current || result.isFallback);
      toast({ title: 'Availability updated', description: `${driver.name} is now ${status === 'AVAILABLE' ? 'available' : 'offline'}.`, tone: 'success' });
    } catch { setError('Unable to update driver availability.'); }
    finally { setIsUpdating(false); }
  };

  if (isLoading) return <main className="mx-auto max-w-[94rem] px-5 py-10"><PageSkeleton /></main>;
  if (error && !driver) return <main className="mx-auto max-w-4xl px-5 py-10"><ErrorState message={error} onRetry={() => void load()} /></main>;
  if (!driver) return null;
  const status = driverStatus(driver.status);
  const initials = driver.name.split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase();

  return <main className="mx-auto max-w-[94rem] px-4 py-7 sm:px-8 sm:py-10 xl:px-12">
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><Link to="/admin/fleet" className="text-[10px] font-bold tracking-wider text-neutral-400 uppercase hover:text-neutral-950">← Back to fleet</Link><div className="mt-4 flex items-center gap-4"><span className="flex size-14 items-center justify-center rounded-2xl bg-neutral-950 text-sm font-bold text-white">{initials}</span><div><h1 className="text-3xl font-semibold tracking-[-0.04em]">{driver.name}</h1><p className="mt-1 font-mono text-[10px] text-neutral-400">{driver.driverId}</p></div></div></div><div className="flex flex-wrap items-center gap-3"><DataSourceBadge isFallback={isFallback} /><StatusBadge label={status.label} tone={status.tone} pulse={driver.status === 'ON_DELIVERY'} /></div></div>
    {error && <div className="mt-5"><ErrorState message={error} compact /></div>}

    <section className="mt-8 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><DetailLocationMap driver={driver.lat !== null && driver.lng !== null ? { position: [driver.lat, driver.lng], label: `${driver.name} · ${formatLocationFreshness(driver.locationUpdatedAt)}` } : null} destination={currentAssignment ? { position: [currentAssignment.lat, currentAssignment.lng], label: formatLocationInEnglish(currentAssignment.dropoffAddress) } : null} /><div className="grid gap-px bg-neutral-200 sm:grid-cols-3"><Info label="Current area" value={formatLocationInEnglish(driver.currentArea)} /><Info label="Last location" value={formatLocationFreshness(driver.locationUpdatedAt)} /><Info label="Location stream" value={realtimeStatus === 'connected' ? 'WebSocket live' : realtimeStatus === 'retrying' ? 'Reconnecting' : 'Connecting'} /></div></div>
      <div className="space-y-5">
        <Panel title="Vehicle information"><InfoRow label="Vehicle plate" value={driver.vehiclePlate} /><InfoRow label="Phone" value={driver.phone} /><InfoRow label="Last profile update" value={dateTime(driver.updatedAt)} /></Panel>
        <Panel title="Today's performance"><p className="text-4xl font-semibold tracking-tight">{driver.completedToday}</p><p className="mt-2 text-[10px] text-neutral-400">Deliveries completed today</p></Panel>
        <Panel title="Availability control">{driver.status === 'ON_DELIVERY' ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><StatusBadge label="Locked while delivering" tone="warning" /><p className="mt-2 text-[10px] leading-4 text-amber-800">Complete the current assignment before changing availability.</p></div> : <div className="grid grid-cols-2 gap-2"><Button variant={driver.status === 'AVAILABLE' ? 'primary' : 'secondary'} isLoading={isUpdating} onClick={() => void changeStatus('AVAILABLE')}>Available</Button><Button variant={driver.status === 'OFFLINE' ? 'primary' : 'secondary'} disabled={isUpdating} onClick={() => void changeStatus('OFFLINE')}>Offline</Button></div>}</Panel>
      </div>
    </section>

    <section className="mt-6 grid gap-5 xl:grid-cols-[0.7fr_1.3fr]">
      <Panel title="Current assignment">{currentAssignment ? <Link to={`/admin/orders/${currentAssignment.orderId}`} className="block rounded-xl border border-neutral-200 p-4 transition hover:border-neutral-950"><div className="flex items-center justify-between"><span className="font-mono text-xs font-bold">CF-{currentAssignment.orderId.slice(0, 8).toUpperCase()}</span><StatusBadge label={currentAssignment.status === 'IN_PROGRESS' ? 'In transit' : 'Assigned'} tone={currentAssignment.status === 'IN_PROGRESS' ? 'warning' : 'info'} /></div><p className="mt-4 text-sm font-bold">{currentAssignment.customerName}</p><p className="mt-1 text-[10px] leading-4 text-neutral-500">{formatLocationInEnglish(currentAssignment.dropoffAddress)}</p></Link> : <EmptyState title="No current assignment" description="This driver is ready for a new delivery." className="border-0" />}</Panel>
      <Panel title="Recent delivery history">{history.length ? <div className="divide-y divide-neutral-100">{history.map((order) => <Link key={order.orderId} to={`/admin/orders/${order.orderId}`} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0"><span className="flex size-8 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700">✓</span><div className="min-w-0 flex-1"><p className="text-xs font-bold">{order.customerName}</p><p className="mt-1 truncate text-[10px] text-neutral-400">{formatLocationInEnglish(order.dropoffAddress)}</p></div><div className="text-right"><p className="font-mono text-[9px]">CF-{order.orderId.slice(0, 8).toUpperCase()}</p><p className="mt-1 text-[9px] text-neutral-400">{dateTime(order.deliveredAt)}</p></div></Link>)}</div> : <EmptyState title="No delivery history" description="Completed assignments will be listed here." className="border-0" />}</Panel>
    </section>
  </main>;
};

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6"><h2 className="mb-5 text-sm font-bold">{title}</h2>{children}</section>;
const Info = ({ label, value }: { label: string; value: string }) => <div className="bg-white p-4"><p className="text-[8px] font-bold tracking-wider text-neutral-400 uppercase">{label}</p><p className="mt-2 text-[11px] font-semibold leading-5">{value}</p></div>;
const InfoRow = ({ label, value }: { label: string; value: string }) => <div className="flex items-start justify-between gap-5 border-b border-neutral-100 py-3 first:pt-0 last:border-0 last:pb-0"><span className="text-[10px] text-neutral-400">{label}</span><span className="text-right text-[11px] font-semibold">{value}</span></div>;
