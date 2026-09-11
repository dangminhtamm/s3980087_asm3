import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import {
  Button,
  DataSourceBadge,
  EmptyState,
  ErrorState,
  StatusBadge,
  useToast,
} from '../../components/ui';
import { exportOrdersCsv, listOrders } from '../../features/orders/api/orders.client';
import type { AdminOrder, AdminOrderStatus } from '../../types/admin';
import { formatLocationInEnglish } from '../../utils/location';
import {
  CreateOrderDialog,
  CreateRouteDialog,
  ImportCsvDialog,
} from '../../features/orders/components/OrdersDialogs';

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
