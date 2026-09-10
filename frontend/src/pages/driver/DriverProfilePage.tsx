import { useEffect, useState } from 'react';

import { useCloudFleetAuth } from '../../auth/CloudFleetAuth';
import { runtimeEnv } from '../../config/runtime';
import { getDriver } from '../../services/operations';
import { disableDriverPush, enableDriverPush, getPushSubscription } from '../../services/push';
import type { FleetDriver } from '../../types/admin';
import { formatLocationInEnglish } from '../../utils/location';
import { DataSourceBadge, StatusBadge, useToast } from '../../components/ui';

const initialDriver: FleetDriver = { driverId: 'DRV-018', name: 'Minh Duy', phone: '+84901110018', vehiclePlate: '51A-482.17', currentArea: 'District 1', status: 'ON_DELIVERY', completedToday: 8, lat: null, lng: null, locationUpdatedAt: null, updatedAt: new Date().toISOString() };

export const DriverProfilePage = () => {
  const auth = useCloudFleetAuth();
  const { toast } = useToast();
  const [driver, setDriver] = useState(initialDriver);
  const [isFallback, setIsFallback] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const driverId = auth.user?.username || runtimeEnv('VITE_DRIVER_ID') || 'DRV-018';

  useEffect(() => {
    void getDriver(driverId).then((result) => { setDriver(result.data); setIsFallback(result.isFallback); });
  }, [driverId]);

  useEffect(() => { void getPushSubscription().then((subscription) => setPushEnabled(Boolean(subscription))); }, []);

  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (pushEnabled) await disableDriverPush(driverId);
      else await enableDriverPush(driverId);
      setPushEnabled(!pushEnabled);
      toast({ title: pushEnabled ? 'Notifications disabled' : 'Notifications enabled', description: 'This preference applies to this device.', tone: 'success' });
    } catch (error: unknown) {
      toast({ title: 'Notification setting unchanged', description: error instanceof Error ? error.message : 'Please try again.', tone: 'error' });
    } finally { setPushBusy(false); }
  };

  const initials = driver.name.split(' ').slice(-2).map((part) => part[0]).join('').toUpperCase();

  return (
  <main className="mx-auto w-full max-w-4xl px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
    <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.18em] text-teal-700 uppercase">Personal</p><h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">Driver profile</h1></div><DataSourceBadge isFallback={isFallback} /></div>
    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <div className="flex items-center gap-5 border-b border-slate-100 p-6 sm:p-8">
        <span className="flex size-16 items-center justify-center rounded-full bg-slate-950 text-lg font-black text-white">{initials}</span>
        <div><h2 className="text-xl font-black">{driver.name}</h2><p className="mt-1 font-mono text-xs text-slate-400">Driver ID · {driver.driverId}</p><div className="mt-3"><StatusBadge label={driver.status === 'OFFLINE' ? 'Offline' : 'Active'} tone={driver.status === 'OFFLINE' ? 'neutral' : 'success'} pulse={driver.status !== 'OFFLINE'} /></div></div>
      </div>
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2">
        {[['Phone number', driver.phone], ['Vehicle plate', driver.vehiclePlate], ['Current area', formatLocationInEnglish(driver.currentArea)], ['Delivered today', `${driver.completedToday} orders`]].map(([label, value]) => <div key={label} className="bg-white p-6"><p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">{label}</p><p className="mt-2 text-sm font-black">{value}</p></div>)}
      </div>
    </section>
    <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-black">Quick settings</h2>
      <div className="mt-4 divide-y divide-slate-100">
        <label className="flex cursor-pointer items-center justify-between py-4 text-sm font-bold"><span><span className="block">New delivery notifications</span><span className="mt-1 block text-[10px] font-normal text-slate-400">Push alerts for assignments and route changes</span></span><input type="checkbox" checked={pushEnabled} disabled={pushBusy} onChange={() => void togglePush()} className="size-4 accent-slate-950" /></label>
        {['Share live location', 'Notification sounds'].map((setting, index) => <label key={setting} className="flex cursor-pointer items-center justify-between py-4 text-sm font-bold"><span>{setting}</span><input type="checkbox" defaultChecked={index === 0} onChange={() => toast({ title: 'Preference updated', description: `${setting} was updated for this device.`, tone: 'success' })} className="size-4 accent-slate-950" /></label>)}
      </div>
    </section>
  </main>
  );
};
