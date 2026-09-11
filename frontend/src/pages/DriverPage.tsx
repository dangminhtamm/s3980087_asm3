import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCloudFleetAuth } from '../auth/CloudFleetAuth';
import { runtimeEnv } from '../config/runtime';
import { DriverOrderDetails } from '../components/DriverOrderDetails';
import {
  Button,
  DataSourceBadge,
  EmptyState,
  ErrorState,
  Skeleton,
  useToast,
} from '../components/ui';
import { useDriverLocationTracking } from '../hooks/useDriverLocationTracking';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { listOrders } from '../services/operations';
import type { AdminOrder } from '../types/admin';
import type { MapCoordinate } from '../types/map';
import type { DeliveryOrder } from '../types/order';
import { formatLocationInEnglish } from '../utils/location';

const REFRESH_INTERVAL_MS = 10_000;

const toDeliveryOrder = (order: AdminOrder): DeliveryOrder => ({
  orderId: order.orderId,
  customerName: order.customerName,
  dropoffAddress: formatLocationInEnglish(order.dropoffAddress),
  region: formatLocationInEnglish(order.region),
  lat: order.lat,
  lng: order.lng,
  status: order.status,
  createdAt: order.createdAt,
  deliveredAt: order.deliveredAt,
  location: { lat: order.lat, lng: order.lng },
});

export const DriverPage = () => {
  const auth = useCloudFleetAuth();
  const { toast } = useToast();
  const isOnline = useNetworkStatus();
  const driverId = auth.user?.username || runtimeEnv('VITE_DRIVER_ID') || 'DRV-018';
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [recentlyDeliveredId, setRecentlyDeliveredId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAssignedOrders = useCallback(
    async (silent = false) => {
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);

      try {
        const result = await listOrders({ driverId, limit: 50 });
        setOrders(result.data);
        setIsFallback(result.isFallback);
      } catch {
        setError('Unable to load your assigned deliveries. Please try again.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [driverId],
  );

  useEffect(() => {
    void loadAssignedOrders();
    const refreshTimer = window.setInterval(
      () => void loadAssignedOrders(true),
      REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(refreshTimer);
  }, [loadAssignedOrders]);

  const inProgressOrder = useMemo(
    () =>
      orders.find((order) => order.status === 'IN_PROGRESS' || order.status === 'ARRIVED') ?? null,
    [orders],
  );
  const pendingOrders = useMemo(
    () =>
      orders
        .filter((order) => order.status === 'ASSIGNED')
        .sort((left, right) => {
          if (left.routeId && left.routeId === right.routeId)
            return (left.stopSequence ?? 999) - (right.stopSequence ?? 999);
          if (left.plannedArrivalAt && right.plannedArrivalAt)
            return left.plannedArrivalAt.localeCompare(right.plannedArrivalAt);
          return left.createdAt.localeCompare(right.createdAt);
        }),
    [orders],
  );
  const recentlyDeliveredOrder = useMemo(
    () =>
      recentlyDeliveredId
        ? (orders.find((order) => order.orderId === recentlyDeliveredId) ?? null)
        : null,
    [orders, recentlyDeliveredId],
  );
  const currentAssignment = inProgressOrder ?? pendingOrders[0] ?? null;
  const displayedOrder = recentlyDeliveredOrder ?? currentAssignment;
  const nextOrder = useMemo(
    () => pendingOrders.find((order) => order.orderId !== displayedOrder?.orderId) ?? null,
    [displayedOrder?.orderId, pendingOrders],
  );
  const locationTracking = useDriverLocationTracking(driverId, inProgressOrder !== null);
  const driverLocation = useMemo<MapCoordinate | null>(() => {
    if (!locationTracking.lastLocation) return null;

    return [locationTracking.lastLocation.lat, locationTracking.lastLocation.lng];
  }, [locationTracking.lastLocation]);

  const handleDelivered = useCallback(
    (orderId: string) => {
      setRecentlyDeliveredId(orderId);
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.orderId === orderId
            ? { ...order, status: 'DELIVERED', deliveredAt: new Date().toISOString() }
            : order,
        ),
      );
      toast({
        title: 'Delivery completed',
        description: 'Proof of Delivery has been secured and the order was updated.',
        tone: 'success',
      });
    },
    [toast],
  );

  const handleStarted = useCallback(
    (orderId: string) => {
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.orderId === orderId ? { ...order, status: 'IN_PROGRESS' } : order,
        ),
      );
      toast({
        title: 'Route started',
        description: 'Live location sharing is now active.',
        tone: 'success',
      });
    },
    [toast],
  );

  const handleArrived = useCallback(
    (orderId: string) => {
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.orderId === orderId ? { ...order, status: 'ARRIVED' } : order,
        ),
      );
      toast({
        title: 'Arrival recorded',
        description: 'You can now capture Proof of Delivery.',
        tone: 'success',
      });
    },
    [toast],
  );

  const handleException = useCallback(
    (orderId: string) => {
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.orderId === orderId ? { ...order, status: 'DELIVERY_FAILED' } : order,
        ),
      );
      toast({
        title: 'Delivery exception reported',
        description: 'Dispatch can now reschedule the order or start a return.',
        tone: 'error',
      });
    },
    [toast],
  );

  const trackingLabel = (() => {
    if (!inProgressOrder) return 'Location sharing starts with the route';
    if (locationTracking.status === 'tracking') return 'Sharing real-time location';
    if (locationTracking.status === 'requesting') return 'Waiting for location permission';
    if (locationTracking.status === 'denied') return 'Location permission denied';
    if (locationTracking.status === 'unsupported')
      return 'Location is not supported on this device';
    if (locationTracking.status === 'error') return 'Unable to update location';
    return 'Starting location tracking…';
  })();

  return (
    <div>
      <div className="mx-auto mt-5 max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span
              className={`size-1.5 rounded-full ${
                locationTracking.status === 'tracking'
                  ? 'bg-emerald-500'
                  : ['denied', 'error', 'unsupported'].includes(locationTracking.status)
                    ? 'bg-red-500'
                    : 'bg-amber-500'
              }`}
            />
            {trackingLabel}
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold ${isOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}
            >
              <span
                className={`size-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`}
              />
              {isOnline ? 'Network online' : 'Network offline'}
            </span>
            <DataSourceBadge isFallback={isFallback} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadAssignedOrders(true)}
              isLoading={isRefreshing}
            >
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-auto mt-5 max-w-6xl px-4 sm:px-6 lg:px-8">
          <ErrorState message={error} onRetry={() => void loadAssignedOrders()} compact />
        </div>
      )}

      {isLoading ? (
        <div className="mx-auto mt-10 max-w-6xl px-4 sm:px-6 lg:px-8">
          <Skeleton className="h-96 rounded-3xl" />
        </div>
      ) : displayedOrder ? (
        <DriverOrderDetails
          key={displayedOrder.orderId}
          order={toDeliveryOrder(displayedOrder)}
          driverId={driverId}
          driverLocation={driverLocation}
          locationTracking={locationTracking}
          isOnline={isOnline}
          nextDelivery={nextOrder ? toDeliveryOrder(nextOrder) : null}
          onStarted={handleStarted}
          onArrived={handleArrived}
          onException={handleException}
          onDelivered={handleDelivered}
          onContinue={() => setRecentlyDeliveredId(null)}
        />
      ) : (
        <NoAssignedDelivery driverId={driverId} />
      )}
    </div>
  );
};

const NoAssignedDelivery = ({ driverId }: { driverId: string }) => (
  <main className="mx-auto grid min-h-[32rem] w-full max-w-4xl place-items-center px-4 py-10 sm:px-6 lg:px-8">
    <EmptyState
      className="w-full rounded-3xl"
      icon={<span className="text-xl">✓</span>}
      title="No new deliveries"
      description={`Driver ${driverId} has no pending or active orders. New deliveries will appear automatically after dispatch assigns them.`}
    />
  </main>
);
