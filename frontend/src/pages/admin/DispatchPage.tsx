import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import { DispatchMap } from '../../components/admin/DispatchMap';
import { Button, ConfirmDialog, DataSourceBadge, EmptyState, ErrorState, StatusBadge, useToast } from '../../components/ui';
import { useDriverLocationStream } from '../../hooks/useDriverLocationStream';
import { assignOrder, listDrivers, listOrders, updateOrderStatus } from '../../services/operations';
import type { AdminOrder, DriverLocation, FleetDriver } from '../../types/admin';
import { formatDistance, formatLocationFreshness, haversineDistanceKm } from '../../utils/geo';
import { formatLocationInEnglish } from '../../utils/location';

type QueueFilter = 'UNASSIGNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'EXCEPTIONS';

interface SuggestedDriver {
  driver: FleetDriver;
  distanceKm: number | null;
}

const queueLabels: Record<QueueFilter, string> = {
  UNASSIGNED: 'Unassigned',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In transit',
  EXCEPTIONS: 'Exceptions',
};

const statusTone = (order: AdminOrder): 'neutral' | 'info' | 'warning' | 'danger' =>
  order.status === 'DELIVERY_FAILED' ? 'danger' : ['IN_PROGRESS', 'ARRIVED', 'RETURNING'].includes(order.status) ? 'warning' : order.driverId ? 'info' : 'neutral';

const orderStatusLabel = (order: AdminOrder): string =>
  ({ PENDING: 'Unassigned', ASSIGNED: 'Assigned', IN_PROGRESS: 'In transit', ARRIVED: 'Arrived', DELIVERY_FAILED: 'Delivery failed', RESCHEDULED: 'Rescheduled', CANCELLED: 'Cancelled', RETURNING: 'Returning', RETURNED: 'Returned', DELIVERED: 'Delivered' })[order.status];

const queuePredicate = (filter: QueueFilter, order: AdminOrder): boolean => {
  if (filter === 'IN_PROGRESS') return ['IN_PROGRESS', 'ARRIVED', 'RETURNING'].includes(order.status);
  if (filter === 'ASSIGNED') return order.status === 'ASSIGNED';
  if (filter === 'EXCEPTIONS') return order.status === 'DELIVERY_FAILED';
  return (order.status === 'PENDING' || order.status === 'RESCHEDULED') && !order.driverId;
};

export const DispatchPage = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [filter, setFilter] = useState<QueueFilter>('UNASSIGNED');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workingOrderId, setWorkingOrderId] = useState<string | null>(null);
  const [confirmStartId, setConfirmStartId] = useState<string | null>(null);

  const handleRealtimeLocation = useCallback((location: DriverLocation) => {
    setDrivers((current) => current.map((driver) => driver.driverId === location.driverId
      ? { ...driver, lat: location.lat, lng: location.lng, locationUpdatedAt: location.recordedAt, updatedAt: location.recordedAt }
      : driver));
  }, []);
  const realtimeStatus = useDriverLocationStream(handleRealtimeLocation);

  const loadBoard = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true); else setIsLoading(true);
    setError(null);
    try {
      const [ordersResult, driversResult] = await Promise.all([listOrders({ limit: 100 }), listDrivers()]);
      const operationalOrders = ordersResult.data.filter((order) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.status));
      setOrders(operationalOrders);
      setDrivers(driversResult.data);
      setSelectedOrderId((current) => current && operationalOrders.some((order) => order.orderId === current)
        ? current
        : operationalOrders.find((order) => !order.driverId)?.orderId ?? operationalOrders[0]?.orderId ?? null);
      setIsFallback(ordersResult.isFallback || driversResult.isFallback);
    } catch {
      setError('Unable to load the dispatch operation.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadBoard();
    const timer = window.setInterval(() => void loadBoard(true), 10_000);
    return () => window.clearInterval(timer);
  }, [loadBoard]);

  const selectedOrder = useMemo(() => orders.find((order) => order.orderId === selectedOrderId) ?? null, [orders, selectedOrderId]);
  const suggestedDrivers = useMemo<SuggestedDriver[]>(() => {
    if (!selectedOrder) return [];
    return drivers
      .filter((driver) => driver.status === 'AVAILABLE')
      .map((driver) => ({
        driver,
        distanceKm: driver.lat !== null && driver.lng !== null
          ? haversineDistanceKm([driver.lat, driver.lng], [selectedOrder.lat, selectedOrder.lng])
          : null,
      }))
      .sort((left, right) => (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY));
  }, [drivers, selectedOrder]);
  const selectedDriver = useMemo(() => drivers.find((driver) => driver.driverId === selectedDriverId) ?? null, [drivers, selectedDriverId]);
  const displayedOrders = useMemo(() => orders.filter((order) => queuePredicate(filter, order)), [filter, orders]);

  useEffect(() => {
    if (!selectedOrder) { setSelectedDriverId(null); return; }
    if (selectedOrder.driverId) { setSelectedDriverId(selectedOrder.driverId); return; }
    setSelectedDriverId((current) => suggestedDrivers.some(({ driver }) => driver.driverId === current)
      ? current
      : suggestedDrivers[0]?.driver.driverId ?? null);
  }, [selectedOrder, suggestedDrivers]);

  const selectOrder = useCallback((orderId: string) => {
    const order = orders.find((candidate) => candidate.orderId === orderId);
    if (!order) return;
    setSelectedOrderId(orderId);
    setFilter(order.status === 'DELIVERY_FAILED' ? 'EXCEPTIONS' : ['IN_PROGRESS', 'ARRIVED', 'RETURNING'].includes(order.status) ? 'IN_PROGRESS' : order.status === 'ASSIGNED' ? 'ASSIGNED' : 'UNASSIGNED');
  }, [orders]);

  const selectQueue = useCallback((queue: QueueFilter) => {
    setFilter(queue);
    setSelectedOrderId(orders.find((order) => queuePredicate(queue, order))?.orderId ?? null);
  }, [orders]);

  const assign = async () => {
    if (!selectedOrder || !selectedDriver || selectedDriver.status !== 'AVAILABLE') return;
    setWorkingOrderId(selectedOrder.orderId);
    setError(null);
    try {
      const result = await assignOrder(selectedOrder.orderId, selectedDriver.driverId);
      setOrders((current) => current.map((order) => order.orderId === selectedOrder.orderId ? result.data : order));
      setDrivers((current) => current.map((driver) => driver.driverId === selectedDriver.driverId ? { ...driver, status: 'ON_DELIVERY' } : driver));
      setFilter('ASSIGNED');
      setIsFallback((current) => current || result.isFallback);
      toast({ title: 'Driver assigned', description: `${selectedDriver.name} is assigned to CF-${selectedOrder.orderId.slice(0, 8).toUpperCase()}.`, tone: 'success' });
    } catch {
      setError('Unable to assign this driver. Their availability may have changed.');
      void loadBoard(true);
    } finally {
      setWorkingOrderId(null);
    }
  };

  const startDelivery = async (orderId: string) => {
    setWorkingOrderId(orderId);
    setError(null);
    try {
      const result = await updateOrderStatus(orderId, 'IN_PROGRESS');
      setOrders((current) => current.map((order) => order.orderId === orderId ? result.data : order));
      setFilter('IN_PROGRESS');
      setIsFallback((current) => current || result.isFallback);
      setConfirmStartId(null);
      toast({ title: 'Delivery started', description: 'The order is now active in the driver workspace.', tone: 'success' });
    } catch {
      setError('Unable to start this delivery. Reload the queue and try again.');
    } finally {
      setWorkingOrderId(null);
    }
  };

  const queueCount = (queue: QueueFilter): number => orders.filter((order) => queuePredicate(queue, order)).length;
  const selectedDistance = selectedOrder && selectedDriver?.lat !== null && selectedDriver?.lng !== null && selectedDriver
    ? haversineDistanceKm([selectedDriver.lat, selectedDriver.lng], [selectedOrder.lat, selectedOrder.lng])
    : null;

  return (
    <main className="mx-auto max-w-[100rem] px-4 py-7 sm:px-8 sm:py-10 xl:px-10">
      <AdminPageHeader
        eyebrow="Operations / Dispatch"
        title="Live dispatch"
        description="Select an order, compare nearby drivers and move each delivery into operation without leaving the map."
        action={<div className="flex gap-2"><Button variant="secondary" isLoading={isRefreshing} onClick={() => void loadBoard(true)}>Refresh</Button><Link to="/admin/orders" className="inline-flex h-10 items-center rounded-lg bg-neutral-950 px-4 text-xs font-bold text-white">+ Create order</Link></div>}
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <DataSourceBadge isFallback={isFallback} />
        <span className="rounded-full border border-neutral-200 bg-white px-3 py-1.5"><StatusBadge label={realtimeStatus === 'connected' ? 'Locations live' : realtimeStatus === 'retrying' ? 'Location stream reconnecting' : 'Connecting location stream'} tone={realtimeStatus === 'connected' ? 'success' : 'warning'} pulse={realtimeStatus === 'connected'} /></span>
        <p className="text-[10px] text-neutral-400">Distances are straight-line estimates calculated with Haversine.</p>
      </div>
      {error && <div className="mt-4"><ErrorState message={error} onRetry={() => void loadBoard()} compact /></div>}

      {isLoading ? <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_26rem]"><div className="h-[43rem] animate-pulse rounded-2xl bg-neutral-200" /><div className="h-[43rem] animate-pulse rounded-2xl bg-neutral-200" /></div> : (
        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_26rem]">
          <section className="lg:sticky lg:top-24">
            <DispatchMap orders={orders} drivers={drivers} selectedOrder={selectedOrder} selectedDriver={selectedDriver} onSelectOrder={selectOrder} onSelectDriver={setSelectedDriverId} />
          </section>

          <section className="flex min-h-[43rem] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white lg:h-[43rem]">
            <header className="border-b border-neutral-100 px-5 py-4">
              <div className="flex items-center justify-between"><div><h2 className="text-sm font-bold">Dispatch queue</h2><p className="mt-1 text-[10px] text-neutral-400">{orders.length} operational orders</p></div><span className="size-2 rounded-full bg-emerald-500" /></div>
              <div className="mt-4 grid grid-cols-4 gap-1 rounded-lg bg-neutral-100 p-1">
                {(Object.keys(queueLabels) as QueueFilter[]).map((queue) => <button key={queue} type="button" onClick={() => selectQueue(queue)} className={`rounded-md px-2 py-2 text-[9px] font-bold transition ${filter === queue ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-500'}`}>{queueLabels[queue]} <span className="ml-1 text-neutral-400">{queueCount(queue)}</span></button>)}
              </div>
            </header>

            <div className="max-h-56 overflow-y-auto border-b border-neutral-100 p-2">
              {displayedOrders.map((order) => (
                <button key={order.orderId} type="button" onClick={() => selectOrder(order.orderId)} className={`w-full rounded-xl border p-3 text-left transition ${selectedOrderId === order.orderId ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-transparent hover:border-neutral-200 hover:bg-neutral-50'}`}>
                  <div className="flex items-center justify-between gap-3"><span className="font-mono text-[10px] font-bold">CF-{order.orderId.slice(0, 8).toUpperCase()}</span><StatusBadge label={orderStatusLabel(order)} tone={statusTone(order)} className={selectedOrderId === order.orderId ? 'text-neutral-300' : ''} /></div>
                  <p className="mt-2 text-xs font-bold">{order.customerName}</p><p className={`mt-1 truncate text-[10px] ${selectedOrderId === order.orderId ? 'text-neutral-400' : 'text-neutral-500'}`}>{formatLocationInEnglish(order.dropoffAddress)}</p>
                </button>
              ))}
              {displayedOrders.length === 0 && <EmptyState eyebrow="Queue clear" title="No orders" description={`There are no ${queueLabels[filter].toLowerCase()} orders.`} className="border-0 px-4 py-8" />}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {selectedOrder ? <OrderDispatchDetail
                order={selectedOrder}
                selectedDriver={selectedDriver}
                selectedDistance={selectedDistance}
                suggestedDrivers={suggestedDrivers}
                isWorking={workingOrderId === selectedOrder.orderId}
                onSelectDriver={setSelectedDriverId}
                onAssign={() => void assign()}
                onStart={() => setConfirmStartId(selectedOrder.orderId)}
              /> : <EmptyState title="Select an order" description="Choose an order from the queue or click a destination marker on the map." className="border-0" />}
            </div>
          </section>
        </div>
      )}

      <ConfirmDialog isOpen={confirmStartId !== null} onClose={() => setConfirmStartId(null)} onConfirm={() => confirmStartId && void startDelivery(confirmStartId)} isLoading={confirmStartId !== null && workingOrderId === confirmStartId} title="Start this delivery?" description="The order will move to In transit and location sharing will begin in the assigned driver's workspace." confirmLabel="Start delivery" />
    </main>
  );
};

interface OrderDispatchDetailProps {
  order: AdminOrder;
  selectedDriver: FleetDriver | null;
  selectedDistance: number | null;
  suggestedDrivers: SuggestedDriver[];
  isWorking: boolean;
  onSelectDriver: (driverId: string) => void;
  onAssign: () => void;
  onStart: () => void;
}

const OrderDispatchDetail = ({ order, selectedDriver, selectedDistance, suggestedDrivers, isWorking, onSelectDriver, onAssign, onStart }: OrderDispatchDetailProps) => (
  <div>
    <div className="flex items-start justify-between gap-4"><div><p className="text-[9px] font-bold tracking-[0.16em] text-neutral-400 uppercase">Selected destination</p><h3 className="mt-2 text-base font-bold">{order.customerName}</h3></div><StatusBadge label={orderStatusLabel(order)} tone={statusTone(order)} pulse={order.status === 'IN_PROGRESS'} /></div>
    <p className="mt-3 text-[11px] leading-5 text-neutral-500">{formatLocationInEnglish(order.dropoffAddress)}</p>
    <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-neutral-200 ring-1 ring-neutral-200"><div className="bg-neutral-50 p-3"><p className="text-[8px] font-bold tracking-wider text-neutral-400 uppercase">Region</p><p className="mt-1 text-[11px] font-bold">{formatLocationInEnglish(order.region)}</p></div><div className="bg-neutral-50 p-3"><p className="text-[8px] font-bold tracking-wider text-neutral-400 uppercase">Coordinates</p><p className="mt-1 font-mono text-[9px] font-bold">{order.lat.toFixed(4)}, {order.lng.toFixed(4)}</p></div></div>

    {!order.driverId ? <>
      <div className="mt-6 flex items-center justify-between"><div><p className="text-[9px] font-bold tracking-[0.16em] text-neutral-400 uppercase">Suggested drivers</p><p className="mt-1 text-[10px] text-neutral-500">Ranked by direct distance</p></div><span className="text-[10px] font-bold">{suggestedDrivers.length} available</span></div>
      <div className="mt-3 space-y-2">
        {suggestedDrivers.slice(0, 4).map(({ driver, distanceKm }, index) => (
          <button key={driver.driverId} type="button" onClick={() => onSelectDriver(driver.driverId)} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selectedDriver?.driverId === driver.driverId ? 'border-neutral-950 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-400'}`}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-[10px] font-bold text-white">{index + 1}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{driver.name}</span><span className="mt-1 block truncate text-[9px] text-neutral-400">{driver.vehiclePlate} · {formatLocationFreshness(driver.locationUpdatedAt)}</span></span>
            <span className="text-[10px] font-bold">{distanceKm === null ? 'No GPS' : formatDistance(distanceKm)}</span>
          </button>
        ))}
        {suggestedDrivers.length === 0 && <p className="rounded-xl border border-dashed border-neutral-200 p-5 text-center text-[10px] text-neutral-400">No available drivers right now.</p>}
      </div>
      <Button className="mt-4 w-full" isLoading={isWorking} disabled={!selectedDriver || selectedDriver.status !== 'AVAILABLE'} onClick={onAssign}>Assign {selectedDriver?.name ?? 'driver'}{selectedDistance !== null ? ` · ${formatDistance(selectedDistance)}` : ''}</Button>
    </> : <AssignedDriver driver={selectedDriver} distance={selectedDistance} orderStatus={order.status} isWorking={isWorking} onStart={onStart} />}
  </div>
);

const AssignedDriver = ({ driver, distance, orderStatus, isWorking, onStart }: { driver: FleetDriver | null; distance: number | null; orderStatus: AdminOrder['status']; isWorking: boolean; onStart: () => void }) => (
  <div className="mt-6">
    <p className="text-[9px] font-bold tracking-[0.16em] text-neutral-400 uppercase">Assigned driver</p>
    <div className="mt-3 rounded-xl border border-neutral-200 p-4">
      <div className="flex items-center justify-between"><div><p className="text-sm font-bold">{driver?.name ?? 'Loading driver…'}</p><p className="mt-1 text-[10px] text-neutral-400">{driver?.driverId} · {driver?.vehiclePlate}</p></div><StatusBadge label={orderStatus === 'IN_PROGRESS' ? 'En route' : 'Ready'} tone={orderStatus === 'IN_PROGRESS' ? 'warning' : 'info'} pulse={orderStatus === 'IN_PROGRESS'} /></div>
      <div className="mt-4 flex items-center justify-between border-t border-neutral-100 pt-3"><span className="text-[10px] text-neutral-500">{formatLocationFreshness(driver?.locationUpdatedAt ?? null)}</span><span className="text-[10px] font-bold">{distance === null ? 'Distance unavailable' : `${formatDistance(distance)} direct`}</span></div>
    </div>
    {orderStatus === 'ASSIGNED' ? <Button className="mt-4 w-full" isLoading={isWorking} onClick={onStart}>Start delivery</Button> : <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><StatusBadge label={orderStatus === 'DELIVERY_FAILED' ? 'Needs resolution' : 'Delivery in progress'} tone={orderStatus === 'DELIVERY_FAILED' ? 'danger' : 'warning'} pulse={orderStatus === 'IN_PROGRESS'} /><p className="mt-2 text-[10px] leading-4 text-amber-800">Live driver updates will continue to move the marker on the map.</p></div>}
  </div>
);
