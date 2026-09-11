import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../components/ui';
import { useDriverLocationStream } from '../../hooks/useDriverLocationStream';
import { listDrivers } from '../../features/drivers/api/drivers.client';
import {
  assignOrder,
  listOrders,
  updateOrderStatus,
} from '../../features/orders/api/orders.client';
import type { AdminOrder, DriverLocation, FleetDriver } from '../../types/admin';
import { haversineDistanceKm } from '../../utils/geo';
import { DispatchView } from '../../features/routes/components/DispatchView';

type QueueFilter = 'UNASSIGNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'EXCEPTIONS';

interface SuggestedDriver {
  driver: FleetDriver;
  distanceKm: number | null;
}

const queuePredicate = (filter: QueueFilter, order: AdminOrder): boolean => {
  if (filter === 'IN_PROGRESS')
    return ['IN_PROGRESS', 'ARRIVED', 'RETURNING'].includes(order.status);
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
    setDrivers((current) =>
      current.map((driver) =>
        driver.driverId === location.driverId
          ? {
              ...driver,
              lat: location.lat,
              lng: location.lng,
              locationUpdatedAt: location.recordedAt,
              updatedAt: location.recordedAt,
            }
          : driver,
      ),
    );
  }, []);
  const realtimeStatus = useDriverLocationStream(handleRealtimeLocation);

  const loadBoard = useCallback(async (silent = false) => {
    if (silent) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);
    try {
      const [ordersResult, driversResult] = await Promise.all([
        listOrders({ limit: 100 }),
        listDrivers(),
      ]);
      const operationalOrders = ordersResult.data.filter(
        (order) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.status),
      );
      setOrders(operationalOrders);
      setDrivers(driversResult.data);
      setSelectedOrderId((current) =>
        current && operationalOrders.some((order) => order.orderId === current)
          ? current
          : (operationalOrders.find((order) => !order.driverId)?.orderId ??
            operationalOrders[0]?.orderId ??
            null),
      );
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

  const selectedOrder = useMemo(
    () => orders.find((order) => order.orderId === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  );
  const suggestedDrivers = useMemo<SuggestedDriver[]>(() => {
    if (!selectedOrder) return [];
    return drivers
      .filter((driver) => driver.status === 'AVAILABLE')
      .map((driver) => ({
        driver,
        distanceKm:
          driver.lat !== null && driver.lng !== null
            ? haversineDistanceKm([driver.lat, driver.lng], [selectedOrder.lat, selectedOrder.lng])
            : null,
      }))
      .sort(
        (left, right) =>
          (left.distanceKm ?? Number.POSITIVE_INFINITY) -
          (right.distanceKm ?? Number.POSITIVE_INFINITY),
      );
  }, [drivers, selectedOrder]);
  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.driverId === selectedDriverId) ?? null,
    [drivers, selectedDriverId],
  );
  const displayedOrders = useMemo(
    () => orders.filter((order) => queuePredicate(filter, order)),
    [filter, orders],
  );

  useEffect(() => {
    if (!selectedOrder) {
      setSelectedDriverId(null);
      return;
    }
    if (selectedOrder.driverId) {
      setSelectedDriverId(selectedOrder.driverId);
      return;
    }
    setSelectedDriverId((current) =>
      suggestedDrivers.some(({ driver }) => driver.driverId === current)
        ? current
        : (suggestedDrivers[0]?.driver.driverId ?? null),
    );
  }, [selectedOrder, suggestedDrivers]);

  const selectOrder = useCallback(
    (orderId: string) => {
      const order = orders.find((candidate) => candidate.orderId === orderId);
      if (!order) return;
      setSelectedOrderId(orderId);
      setFilter(
        order.status === 'DELIVERY_FAILED'
          ? 'EXCEPTIONS'
          : ['IN_PROGRESS', 'ARRIVED', 'RETURNING'].includes(order.status)
            ? 'IN_PROGRESS'
            : order.status === 'ASSIGNED'
              ? 'ASSIGNED'
              : 'UNASSIGNED',
      );
    },
    [orders],
  );

  const selectQueue = useCallback(
    (queue: QueueFilter) => {
      setFilter(queue);
      setSelectedOrderId(orders.find((order) => queuePredicate(queue, order))?.orderId ?? null);
    },
    [orders],
  );

  const assign = async () => {
    if (!selectedOrder || !selectedDriver || selectedDriver.status !== 'AVAILABLE') return;
    setWorkingOrderId(selectedOrder.orderId);
    setError(null);
    try {
      const result = await assignOrder(selectedOrder.orderId, selectedDriver.driverId);
      setOrders((current) =>
        current.map((order) => (order.orderId === selectedOrder.orderId ? result.data : order)),
      );
      setDrivers((current) =>
        current.map((driver) =>
          driver.driverId === selectedDriver.driverId
            ? { ...driver, status: 'ON_DELIVERY' }
            : driver,
        ),
      );
      setFilter('ASSIGNED');
      setIsFallback((current) => current || result.isFallback);
      toast({
        title: 'Driver assigned',
        description: `${selectedDriver.name} is assigned to CF-${selectedOrder.orderId.slice(0, 8).toUpperCase()}.`,
        tone: 'success',
      });
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
      setOrders((current) =>
        current.map((order) => (order.orderId === orderId ? result.data : order)),
      );
      setFilter('IN_PROGRESS');
      setIsFallback((current) => current || result.isFallback);
      setConfirmStartId(null);
      toast({
        title: 'Delivery started',
        description: 'The order is now active in the driver workspace.',
        tone: 'success',
      });
    } catch {
      setError('Unable to start this delivery. Reload the queue and try again.');
    } finally {
      setWorkingOrderId(null);
    }
  };

  const queueCount = (queue: QueueFilter): number =>
    orders.filter((order) => queuePredicate(queue, order)).length;
  const selectedDistance =
    selectedOrder && selectedDriver?.lat !== null && selectedDriver?.lng !== null && selectedDriver
      ? haversineDistanceKm(
          [selectedDriver.lat, selectedDriver.lng],
          [selectedOrder.lat, selectedOrder.lng],
        )
      : null;

  return (
    <DispatchView
      orders={orders}
      drivers={drivers}
      filter={filter}
      selectedOrderId={selectedOrderId}
      selectedOrder={selectedOrder}
      selectedDriver={selectedDriver}
      selectedDistance={selectedDistance}
      suggestedDrivers={suggestedDrivers}
      displayedOrders={displayedOrders}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      isFallback={isFallback}
      error={error}
      workingOrderId={workingOrderId}
      confirmStartId={confirmStartId}
      realtimeStatus={realtimeStatus}
      queueCount={queueCount}
      selectQueue={selectQueue}
      selectOrder={selectOrder}
      selectDriver={setSelectedDriverId}
      assign={assign}
      refresh={() => loadBoard(true)}
      retry={() => loadBoard()}
      setConfirmStartId={setConfirmStartId}
      startDelivery={startDelivery}
    />
  );
};
