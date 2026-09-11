import axios from 'axios';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import {
  Button,
  DataSourceBadge,
  EmptyState,
  ErrorState,
  Modal,
  StatusBadge,
  useToast,
} from '../../components/ui';
import {
  createOrder,
  createRoute,
  exportOrdersCsv,
  importOrdersCsv,
  listDrivers,
  listOrders,
  validateAddress,
} from '../../services/operations';
import type {
  AdminOrder,
  AdminOrderStatus,
  FleetDriver,
  GeocodingCandidate,
} from '../../types/admin';
import { formatLocationInEnglish } from '../../utils/location';

type Filter = 'ALL' | AdminOrderStatus;

const statusLabel: Record<AdminOrderStatus, string> = {
  PENDING: 'Pending',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  ARRIVED: 'Arrived',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery failed',
  RESCHEDULED: 'Rescheduled',
  CANCELLED: 'Cancelled',
  RETURNING: 'Returning',
  RETURNED: 'Returned',
};

export const OrdersPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isRouteOpen, setIsRouteOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadOrders = useCallback(async (silent = false): Promise<void> => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const result = await listOrders({ limit: 100 });
      setOrders(result.data);
      setIsFallback(result.isFallback);
    } catch {
      setError('Unable to load the order list. Please try again.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    const timer = window.setInterval(() => void loadOrders(true), 15_000);
    return () => window.clearInterval(timer);
  }, [loadOrders]);

  const visibleOrders = useMemo(
    () =>
      orders
        .filter((order) => filter === 'ALL' || order.status === filter)
        .filter((order) =>
          [order.orderId, order.customerName, order.dropoffAddress].some((value) =>
            value.toLowerCase().includes(query.toLowerCase()),
          ),
        ),
    [filter, orders, query],
  );

  const handleCreated = (order: AdminOrder, fallback: boolean) => {
    setOrders((current) => [order, ...current]);
    setIsFallback((current) => current || fallback);
    setIsCreateOpen(false);
    toast({
      title: 'Order created',
      description: `CF-${order.orderId.slice(0, 8).toUpperCase()} is ready for dispatch.`,
      tone: 'success',
    });
  };

  return (
    <main className="mx-auto max-w-[94rem] px-5 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <AdminPageHeader
        eyebrow="Operations / Orders"
        title="Order management"
        description="Search, inspect and manage every delivery order across the network."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setIsImportOpen(true)}>
              Import CSV
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void exportOrdersCsv().catch(() => setError('Unable to export orders.'))
              }
            >
              Export CSV
            </Button>
            {selectedIds.size > 0 && (
              <Button variant="secondary" onClick={() => setIsRouteOpen(true)}>
                Plan route ({selectedIds.size})
              </Button>
            )}
            <Button onClick={() => setIsCreateOpen(true)}>+ New order</Button>
          </div>
        }
      />

      <div className="mt-6 flex items-center justify-between">
        <DataSourceBadge isFallback={isFallback} />
        <p className="hidden text-[10px] text-neutral-400 sm:block">
          Auto-refreshes every 15 seconds
        </p>
      </div>
      {error && (
        <div className="mt-4">
          <ErrorState message={error} onRetry={() => void loadOrders()} compact />
        </div>
      )}

      <section className="mt-6 border border-neutral-200 bg-white sm:mt-10">
        <div className="flex flex-col gap-4 border-b border-neutral-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex gap-5 overflow-x-auto text-[10px] font-bold">
            {(
              [
                ['ALL', 'All orders'],
                ['PENDING', 'Pending'],
                ['ASSIGNED', 'Assigned'],
                ['IN_PROGRESS', 'Active'],
                ['DELIVERY_FAILED', 'Exceptions'],
                ['DELIVERED', 'Completed'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`shrink-0 border-b pb-1 ${filter === value ? 'border-neutral-950 text-neutral-950' : 'border-transparent text-neutral-400'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search order or customer"
            className="h-9 w-full border border-neutral-200 px-3 text-xs outline-none focus:border-neutral-950 sm:w-56"
          />
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left">
              <thead className="bg-neutral-50 text-[9px] font-bold tracking-[0.16em] text-neutral-400 uppercase">
                <tr>
                  <th className="border-b border-neutral-200 px-4 py-3">Select</th>
                  {[
                    'Order ID',
                    'Customer',
                    'Destination',
                    'Load / window',
                    'Status',
                    'Created',
                  ].map((item) => (
                    <th key={item} className="border-b border-neutral-200 px-6 py-3">
                      {item}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 text-xs">
                {visibleOrders.map((order) => (
                  <tr
                    key={order.orderId}
                    onClick={() => navigate(`/admin/orders/${order.orderId}`)}
                    className="cursor-pointer transition hover:bg-neutral-50"
                  >
                    <td className="px-4 py-5" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select order ${order.orderId}`}
                        disabled={!['PENDING', 'RESCHEDULED'].includes(order.status)}
                        checked={selectedIds.has(order.orderId)}
                        onChange={(event) =>
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(order.orderId);
                            else next.delete(order.orderId);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-6 py-5 font-mono text-[11px] font-bold">
                      <Link
                        to={`/admin/orders/${order.orderId}`}
                        onClick={(event) => event.stopPropagation()}
                        className="underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-950"
                      >
                        CF-{order.orderId.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-6 py-5">
                      <p className="font-semibold">{order.customerName}</p>
                      <p className="mt-1 text-[9px] text-neutral-400">{order.customerPhone}</p>
                    </td>
                    <td className="max-w-64 truncate px-6 py-5 text-neutral-500">
                      {formatLocationInEnglish(order.dropoffAddress)}
                    </td>
                    <td className="px-6 py-5 text-[10px] text-neutral-500">
                      <p>
                        {order.packageWeightKg ?? 0} kg · {order.packageVolumeM3 ?? 0} m³
                      </p>
                      <p className="mt-1">
                        {order.timeWindowStart
                          ? new Date(order.timeWindowStart).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : 'No time window'}
                      </p>
                    </td>
                    <td className="px-6 py-5">
                      <Status status={order.status} />
                    </td>
                    <td className="px-6 py-5 text-neutral-500">
                      {new Intl.DateTimeFormat('en-AU', {
                        hour: '2-digit',
                        minute: '2-digit',
                        day: '2-digit',
                        month: '2-digit',
                      }).format(new Date(order.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && visibleOrders.length === 0 && (
          <EmptyState
            title="No orders found"
            description="Try changing the status filter or search query."
            className="m-4"
          />
        )}
      </section>

      {isCreateOpen && (
        <CreateOrderDialog onClose={() => setIsCreateOpen(false)} onCreated={handleCreated} />
      )}
      {isImportOpen && (
        <ImportCsvDialog
          onClose={() => setIsImportOpen(false)}
          onImported={() => {
            setIsImportOpen(false);
            void loadOrders();
          }}
        />
      )}
      {isRouteOpen && (
        <CreateRouteDialog
          orderIds={[...selectedIds]}
          onClose={() => setIsRouteOpen(false)}
          onCreated={(routeId) => {
            setSelectedIds(new Set());
            setIsRouteOpen(false);
            void loadOrders();
            navigate(`/admin/routes/${routeId}`);
          }}
        />
      )}
    </main>
  );
};

const CreateOrderDialog = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (order: AdminOrder, fallback: boolean) => void;
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [region, setRegion] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [candidates, setCandidates] = useState<GeocodingCandidate[]>([]);
  const [isValidating, setIsValidating] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await createOrder({
        customerName: String(form.get('customerName')),
        customerPhone: String(form.get('customerPhone')),
        dropoffAddress: address,
        region,
        lat: Number(lat),
        lng: Number(lng),
        timeWindowStart: form.get('timeWindowStart')
          ? new Date(String(form.get('timeWindowStart'))).toISOString()
          : null,
        timeWindowEnd: form.get('timeWindowEnd')
          ? new Date(String(form.get('timeWindowEnd'))).toISOString()
          : null,
        packageWeightKg: Number(form.get('packageWeightKg')),
        packageVolumeM3: Number(form.get('packageVolumeM3')),
        serviceDurationMinutes: Number(form.get('serviceDurationMinutes')),
      });
      onCreated(result.data, result.isFallback);
    } catch (submitError: unknown) {
      const apiMessage = axios.isAxiosError(submitError)
        ? (submitError.response?.data?.error?.message as string | undefined)
        : undefined;
      setError(apiMessage ?? 'Unable to create the order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New delivery order"
      description="Create a validated destination with its delivery constraints."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-order-form" isLoading={isSubmitting}>
            Create order
          </Button>
        </>
      }
    >
      <form id="create-order-form" onSubmit={handleSubmit}>
        <div className="space-y-4 text-xs">
          <Field label="Customer name" name="customerName" placeholder="Alex Nguyen" />
          <Field label="Phone (E.164)" name="customerPhone" type="tel" placeholder="+84901234567" />
          <label className="block">
            <span className="mb-2 block font-semibold text-neutral-600">Drop-off address</span>
            <div className="flex gap-2">
              <input
                required
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setCandidates([]);
                }}
                placeholder="72 Nguyen Hue Street, District 1"
                className="h-11 min-w-0 flex-1 border border-neutral-200 px-3 outline-none focus:border-neutral-950"
              />
              <Button
                type="button"
                variant="secondary"
                isLoading={isValidating}
                onClick={() => {
                  setIsValidating(true);
                  setError(null);
                  void validateAddress(address)
                    .then(setCandidates)
                    .catch(() =>
                      setError(
                        'Address validation is unavailable. You can still enter coordinates manually.',
                      ),
                    )
                    .finally(() => setIsValidating(false));
                }}
              >
                Validate
              </Button>
            </div>
          </label>
          {candidates.length > 0 && (
            <div className="border border-neutral-200 bg-neutral-50 p-2">
              {candidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.placeId}
                  onClick={() => {
                    setAddress(candidate.formattedAddress);
                    setRegion(candidate.region ?? region);
                    setLat(String(candidate.lat));
                    setLng(String(candidate.lng));
                    setCandidates([]);
                  }}
                  className="block w-full border-b border-neutral-200 p-2 text-left text-[10px] last:border-0 hover:bg-white"
                >
                  {candidate.formattedAddress}
                </button>
              ))}
            </div>
          )}
          <label className="block">
            <span className="mb-2 block font-semibold text-neutral-600">Region</span>
            <input
              required
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="District 1"
              className="h-11 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label>
              <span className="mb-2 block font-semibold text-neutral-600">Latitude</span>
              <input
                required
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                type="number"
                step="any"
                placeholder="10.77428"
                className="h-11 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
              />
            </label>
            <label>
              <span className="mb-2 block font-semibold text-neutral-600">Longitude</span>
              <input
                required
                value={lng}
                onChange={(event) => setLng(event.target.value)}
                type="number"
                step="any"
                placeholder="106.70391"
                className="h-11 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Window start"
              name="timeWindowStart"
              type="datetime-local"
              placeholder=""
              required={false}
            />
            <Field
              label="Window end"
              name="timeWindowEnd"
              type="datetime-local"
              placeholder=""
              required={false}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Weight (kg)" name="packageWeightKg" type="number" placeholder="2.5" />
            <Field label="Volume (m³)" name="packageVolumeM3" type="number" placeholder="0.03" />
            <Field
              label="Service (min)"
              name="serviceDurationMinutes"
              type="number"
              placeholder="10"
            />
          </div>
        </div>
        {error && (
          <p className="mt-4 border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
};

const ImportCsvDialog = ({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) => {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!file) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await importOrdersCsv(file);
      toast({
        title: `${result.created} orders imported`,
        description: result.failed
          ? `${result.failed} rows need correction.`
          : 'Every row was accepted.',
        tone: result.failed ? 'info' : 'success',
      });
      onImported();
    } catch (submitError: unknown) {
      setError(
        axios.isAxiosError(submitError)
          ? String(submitError.response?.data?.error?.message ?? 'Unable to import CSV.')
          : 'Unable to import CSV.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Import orders from CSV"
      description="Up to 100 rows. Required headers: customerName, customerPhone, dropoffAddress, region, lat, lng."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!file} isLoading={isSubmitting} onClick={() => void submit()}>
            Import
          </Button>
        </>
      }
    >
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        className="w-full border border-dashed border-neutral-300 p-6 text-xs"
      />
      {error && (
        <p className="mt-4 border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>
      )}
    </Modal>
  );
};

const CreateRouteDialog = ({
  orderIds,
  onClose,
  onCreated,
}: {
  orderIds: string[];
  onClose: () => void;
  onCreated: (routeId: string) => void;
}) => {
  const { toast } = useToast();
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [driverId, setDriverId] = useState('');
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void listDrivers()
      .then((result) => {
        const eligible = result.data.filter((driver) => driver.status !== 'OFFLINE');
        setDrivers(eligible);
        setDriverId(eligible[0]?.driverId ?? '');
      })
      .catch(() => setError('Unable to load drivers.'));
  }, []);
  const submit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const route = await createRoute({ driverId, orderIds, scheduledDate });
      toast({
        title: 'Route planned',
        description: `${route.stopCount} stops assigned to ${route.driverId}.`,
        tone: 'success',
      });
      onCreated(route.routeId);
    } catch (submitError: unknown) {
      setError(
        axios.isAxiosError(submitError)
          ? String(submitError.response?.data?.error?.message ?? 'Unable to create route.')
          : 'Unable to create route.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Plan a multi-stop route"
      description={`${orderIds.length} selected orders will be assigned atomically after capacity checks.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!driverId} isLoading={isSubmitting} onClick={() => void submit()}>
            Create route
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-xs">
        <label className="block">
          <span className="mb-2 block font-semibold text-neutral-600">Driver / capacity</span>
          <select
            value={driverId}
            onChange={(event) => setDriverId(event.target.value)}
            className="h-11 w-full border border-neutral-200 px-3"
          >
            {drivers.map((driver) => (
              <option key={driver.driverId} value={driver.driverId}>
                {driver.name} · {driver.maxWeightKg ?? 20} kg / {driver.maxVolumeM3 ?? 0.25} m³
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block font-semibold text-neutral-600">Scheduled date</span>
          <input
            type="date"
            required
            value={scheduledDate}
            onChange={(event) => setScheduledDate(event.target.value)}
            className="h-11 w-full border border-neutral-200 px-3"
          />
        </label>
        {error && <p className="border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
      </div>
    </Modal>
  );
};

const Field = ({
  label,
  name,
  placeholder,
  type = 'text',
  required = true,
}: {
  label: string;
  name: string;
  placeholder: string;
  type?: string;
  required?: boolean;
}) => (
  <label className="block">
    <span className="mb-2 block font-semibold text-neutral-600">{label}</span>
    <input
      required={required}
      name={name}
      type={type}
      min={type === 'number' ? '0' : undefined}
      step={type === 'number' ? 'any' : undefined}
      placeholder={placeholder}
      className="h-11 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
    />
  </label>
);
const Status = ({ status }: { status: AdminOrderStatus }) => (
  <StatusBadge
    label={statusLabel[status]}
    tone={
      status === 'DELIVERED'
        ? 'success'
        : ['DELIVERY_FAILED', 'CANCELLED'].includes(status)
          ? 'danger'
          : ['IN_PROGRESS', 'ARRIVED', 'RETURNING'].includes(status)
            ? 'warning'
            : status === 'ASSIGNED'
              ? 'info'
              : 'neutral'
    }
    pulse={status === 'IN_PROGRESS'}
  />
);
const TableSkeleton = () => (
  <div className="space-y-px bg-neutral-100">
    {Array.from({ length: 5 }, (_, index) => (
      <div key={index} className="h-16 animate-pulse bg-white p-5">
        <div className="h-3 w-1/2 bg-neutral-100" />
      </div>
    ))}
  </div>
);
