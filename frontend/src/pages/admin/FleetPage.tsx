import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import { Button, DataSourceBadge, EmptyState, ErrorState, useToast } from '../../components/ui';
import { listDrivers, updateDriverStatus } from '../../features/drivers/api/drivers.client';
import type { DriverStatus, FleetDriver } from '../../types/admin';
import { useDriverLocationStream } from '../../hooks/useDriverLocationStream';
import { formatLocationInEnglish } from '../../utils/location';
import { CreateDriverDialog } from '../../features/drivers/components/CreateDriverDialog';

const statusLabel: Record<DriverStatus, string> = {
  AVAILABLE: 'Available',
  ON_DELIVERY: 'On delivery',
  OFFLINE: 'Offline',
};

export const FleetPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const handleRealtimeLocation = useCallback(
    (location: { driverId: string; lat: number; lng: number; recordedAt: string }) => {
      setDrivers((current) =>
        current.map((driver) =>
          driver.driverId === location.driverId
            ? {
                ...driver,
                lat: location.lat,
                lng: location.lng,
                locationUpdatedAt: location.recordedAt,
              }
            : driver,
        ),
      );
    },
    [],
  );
  useDriverLocationStream(handleRealtimeLocation);

  const loadDrivers = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const result = await listDrivers();
      setDrivers(result.data);
      setIsFallback(result.isFallback);
    } catch {
      setError('Unable to load fleet data.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDrivers();
    const timer = window.setInterval(() => void loadDrivers(true), 15_000);
    return () => window.clearInterval(timer);
  }, [loadDrivers]);

  const onlineCount = useMemo(
    () => drivers.filter((driver) => driver.status !== 'OFFLINE').length,
    [drivers],
  );

  const handleStatusChange = async (driverId: string, status: DriverStatus) => {
    setUpdatingId(driverId);
    setError(null);
    try {
      const result = await updateDriverStatus(driverId, status);
      setDrivers((current) =>
        current.map((driver) => (driver.driverId === driverId ? result.data : driver)),
      );
      setIsFallback((current) => current || result.isFallback);
      toast({
        title: 'Driver status updated',
        description: `${driverId} is now ${statusLabel[status].toLowerCase()}.`,
        tone: 'success',
      });
    } catch {
      setError('Unable to update the driver status.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <main className="mx-auto max-w-[94rem] px-5 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <AdminPageHeader
        eyebrow="Operations / Fleet"
        title="Fleet management"
        description="Track driver availability, vehicle assignments and operational status."
        action={
          <Button variant="secondary" onClick={() => setIsCreateOpen(true)}>
            Add driver
          </Button>
        }
      />

      <div className="mt-6 flex items-center justify-between">
        <DataSourceBadge isFallback={isFallback} />
        <p className="hidden text-[10px] text-neutral-400 sm:block">
          Live locations update automatically
        </p>
      </div>
      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={() => void loadDrivers()} compact />
        </div>
      )}

      <section className="mt-6 overflow-hidden border border-neutral-200 bg-white sm:mt-10">
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 sm:px-6">
          <h2 className="text-xs font-bold">All drivers</h2>
          <span className="text-[10px] text-neutral-400">
            {drivers.length} total · {onlineCount} online
          </span>
        </div>
        {isLoading ? (
          <div className="h-72 animate-pulse bg-neutral-50" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-left">
              <thead className="bg-neutral-50 text-[9px] font-bold tracking-[0.16em] text-neutral-400 uppercase">
                <tr>
                  {[
                    'Driver',
                    'Vehicle',
                    'Capacity',
                    'Status',
                    'Current area',
                    'Live location',
                    'Today',
                  ].map((heading) => (
                    <th key={heading} className="border-b border-neutral-200 px-6 py-3">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-xs">
                {drivers.map((driver) => (
                  <tr
                    key={driver.driverId}
                    onClick={() => navigate(`/admin/fleet/${driver.driverId}`)}
                    className="cursor-pointer transition hover:bg-neutral-50"
                  >
                    <td className="px-6 py-5">
                      <Link
                        to={`/admin/fleet/${driver.driverId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="font-bold underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-950"
                      >
                        {driver.name}
                      </Link>
                      <p className="mt-1 font-mono text-[9px] text-neutral-400">
                        {driver.driverId}
                      </p>
                    </td>
                    <td className="px-6 py-5 font-mono text-[11px] text-neutral-600">
                      {driver.vehiclePlate}
                    </td>
                    <td className="px-6 py-5 text-[10px] text-neutral-500">
                      {driver.maxWeightKg ?? 20} kg · {driver.maxVolumeM3 ?? 0.25} m³
                    </td>
                    <td
                      className="px-6 py-5"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <label className="inline-flex items-center gap-2">
                        <span
                          className={`size-1.5 rounded-full ${driver.status === 'ON_DELIVERY' ? 'bg-amber-500' : driver.status === 'AVAILABLE' ? 'bg-emerald-500' : 'bg-neutral-300'}`}
                        />
                        <select
                          aria-label={`Status for ${driver.name}`}
                          value={driver.status}
                          disabled={updatingId === driver.driverId}
                          onChange={(event) =>
                            void handleStatusChange(
                              driver.driverId,
                              event.target.value as DriverStatus,
                            )
                          }
                          className="bg-transparent text-xs font-semibold outline-none disabled:opacity-50"
                        >
                          {Object.entries(statusLabel).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </td>
                    <td className="px-6 py-5 text-neutral-500">
                      {formatLocationInEnglish(driver.currentArea)}
                    </td>
                    <td className="px-6 py-5 font-mono text-[10px] text-neutral-500">
                      {driver.lat !== null && driver.lng !== null
                        ? `${driver.lat.toFixed(5)}, ${driver.lng.toFixed(5)}`
                        : 'Waiting…'}
                    </td>
                    <td className="px-6 py-5 font-bold">{driver.completedToday} deliveries</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && drivers.length === 0 && (
          <EmptyState
            title="No drivers yet"
            description="Add your first driver to start building the CloudFleet network."
            className="m-4"
            action={<Button onClick={() => setIsCreateOpen(true)}>Add driver</Button>}
          />
        )}
      </section>

      {isCreateOpen && (
        <CreateDriverDialog
          onClose={() => setIsCreateOpen(false)}
          onCreated={(driver, fallback) => {
            setDrivers((current) => [driver, ...current]);
            setIsFallback((current) => current || fallback);
            setIsCreateOpen(false);
            toast({
              title: 'Driver added',
              description: `${driver.name} is now part of the fleet.`,
              tone: 'success',
            });
          }}
        />
      )}
    </main>
  );
};
