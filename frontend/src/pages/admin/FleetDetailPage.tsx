import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { ErrorState, PageSkeleton, useToast } from '../../components/ui';
import { useDriverLocationStream } from '../../hooks/useDriverLocationStream';
import { getDriver, updateDriverStatus } from '../../features/drivers/api/drivers.client';
import { listOrders } from '../../features/orders/api/orders.client';
import type { AdminOrder, DriverLocation, DriverStatus, FleetDriver } from '../../types/admin';
import { FleetDetailView } from '../../features/drivers/components/FleetDetailView';

const driverStatus = (
  status: DriverStatus,
): { label: string; tone: 'success' | 'warning' | 'neutral' } =>
  status === 'AVAILABLE'
    ? { label: 'Available', tone: 'success' }
    : status === 'ON_DELIVERY'
      ? { label: 'On delivery', tone: 'warning' }
      : { label: 'Offline', tone: 'neutral' };

export const FleetDetailPage = () => {
  const { driverId } = useParams<{ driverId: string }>();
  const { toast } = useToast();
  const [driver, setDriver] = useState<FleetDriver | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLocation = useCallback(
    (location: DriverLocation) => {
      if (location.driverId !== driverId) return;
      setDriver((current) =>
        current
          ? {
              ...current,
              lat: location.lat,
              lng: location.lng,
              locationUpdatedAt: location.recordedAt,
              updatedAt: location.recordedAt,
            }
          : current,
      );
    },
    [driverId],
  );
  const realtimeStatus = useDriverLocationStream(handleLocation);

  const load = useCallback(
    async (silent = false) => {
      if (!driverId) return;
      if (!silent) setIsLoading(true);
      try {
        const [driverResult, ordersResult] = await Promise.all([
          getDriver(driverId),
          listOrders({ driverId, limit: 50 }),
        ]);
        setDriver(driverResult.data);
        setOrders(ordersResult.data);
        setIsFallback(driverResult.isFallback || ordersResult.isFallback);
        setError(null);
      } catch (loadError: unknown) {
        setError(
          axios.isAxiosError(loadError)
            ? (loadError.response?.data?.error?.message ?? 'Unable to load this driver.')
            : 'Unable to load this driver.',
        );
      } finally {
        setIsLoading(false);
      }
    },
    [driverId],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const currentAssignment = useMemo(
    () =>
      orders.find((order) =>
        ['IN_PROGRESS', 'ARRIVED', 'RETURNING', 'DELIVERY_FAILED'].includes(order.status),
      ) ??
      orders.find((order) => order.status === 'ASSIGNED') ??
      null,
    [orders],
  );
  const history = useMemo(
    () =>
      orders
        .filter((order) => order.status === 'DELIVERED')
        .sort((a, b) => (b.deliveredAt ?? '').localeCompare(a.deliveredAt ?? ''))
        .slice(0, 8),
    [orders],
  );

  const changeStatus = async (status: 'AVAILABLE' | 'OFFLINE') => {
    if (!driver) return;
    setIsUpdating(true);
    try {
      const result = await updateDriverStatus(driver.driverId, status);
      setDriver(result.data);
      setIsFallback((current) => current || result.isFallback);
      toast({
        title: 'Availability updated',
        description: `${driver.name} is now ${status === 'AVAILABLE' ? 'available' : 'offline'}.`,
        tone: 'success',
      });
    } catch {
      setError('Unable to update driver availability.');
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading)
    return (
      <main className="mx-auto max-w-[94rem] px-5 py-10">
        <PageSkeleton />
      </main>
    );
  if (error && !driver)
    return (
      <main className="mx-auto max-w-4xl px-5 py-10">
        <ErrorState message={error} onRetry={() => void load()} />
      </main>
    );
  if (!driver) return null;
  const status = driverStatus(driver.status);
  const initials = driver.name
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    <FleetDetailView
      driver={driver}
      currentAssignment={currentAssignment}
      history={history}
      status={status}
      initials={initials}
      isFallback={isFallback}
      error={error}
      realtimeStatus={realtimeStatus}
      isUpdating={isUpdating}
      changeStatus={changeStatus}
    />
  );
};
