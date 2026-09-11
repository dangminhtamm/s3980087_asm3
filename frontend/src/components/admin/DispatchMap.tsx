import { DivIcon, latLngBounds } from 'leaflet';
import { memo, useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';

import type { AdminOrder, DriverStatus, FleetDriver } from '../../types/admin';
import type { MapCoordinate } from '../../types/map';
import { formatLocationInEnglish } from '../../utils/location';
import { StatusBadge } from '../ui';

const OPEN_STREET_MAP_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_CENTER: MapCoordinate = [10.7769, 106.7009];

const driverIcon = (status: DriverStatus, selected: boolean): DivIcon =>
  new DivIcon({
    className: 'cloudfleet-map-icon',
    html: `<span class="cloudfleet-map-driver cloudfleet-map-driver--${status.toLowerCase().replace('_', '-')}${selected ? ' cloudfleet-map-marker--selected' : ''}"><span></span></span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -17],
  });

const orderIcon = (status: AdminOrder['status'], selected: boolean): DivIcon =>
  new DivIcon({
    className: 'cloudfleet-map-icon',
    html: `<span class="cloudfleet-map-order cloudfleet-map-order--${status.toLowerCase()}${selected ? ' cloudfleet-map-marker--selected' : ''}"><span></span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -17],
  });

const FocusViewport = ({
  order,
  driver,
}: {
  order: AdminOrder | null;
  driver: FleetDriver | null;
}) => {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize({ pan: false });
    if (!order) return;
    const destination: MapCoordinate = [order.lat, order.lng];
    if (driver && driver.lat !== null && driver.lng !== null) {
      map.fitBounds(latLngBounds([destination, [driver.lat, driver.lng]]), {
        maxZoom: 15,
        padding: [70, 70],
        animate: true,
      });
    } else {
      map.flyTo(destination, 15, { animate: true, duration: 0.5 });
    }
  }, [driver, map, order]);
  return null;
};

interface DispatchMapProps {
  orders: AdminOrder[];
  drivers: FleetDriver[];
  selectedOrder: AdminOrder | null;
  selectedDriver: FleetDriver | null;
  onSelectOrder: (orderId: string) => void;
  onSelectDriver: (driverId: string) => void;
}

const DispatchMapComponent = ({
  orders,
  drivers,
  selectedOrder,
  selectedDriver,
  onSelectOrder,
  onSelectDriver,
}: DispatchMapProps) => {
  const locatedDrivers = useMemo(
    () => drivers.filter((driver) => driver.lat !== null && driver.lng !== null),
    [drivers],
  );
  const initialCenter = selectedOrder
    ? ([selectedOrder.lat, selectedOrder.lng] as MapCoordinate)
    : locatedDrivers[0]
      ? ([locatedDrivers[0].lat!, locatedDrivers[0].lng!] as MapCoordinate)
      : DEFAULT_CENTER;
  const connector =
    selectedOrder && selectedDriver && selectedDriver.lat !== null && selectedDriver.lng !== null
      ? ([
          [selectedDriver.lat, selectedDriver.lng],
          [selectedOrder.lat, selectedOrder.lng],
        ] as MapCoordinate[])
      : [];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200">
      <MapContainer
        center={initialCenter}
        zoom={13}
        scrollWheelZoom
        className="cloudfleet-dispatch-map"
        aria-label="Interactive dispatch map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={OPEN_STREET_MAP_URL}
          maxZoom={19}
        />
        {locatedDrivers.map((driver) => (
          <Marker
            key={driver.driverId}
            position={[driver.lat!, driver.lng!]}
            icon={driverIcon(driver.status, selectedDriver?.driverId === driver.driverId)}
            eventHandlers={{ click: () => onSelectDriver(driver.driverId) }}
            zIndexOffset={500}
          >
            <Popup>
              <div className="min-w-44 font-sans">
                <p className="text-sm font-bold">{driver.name}</p>
                <p className="mt-1 text-[10px] text-neutral-500">
                  {driver.driverId} · {driver.vehiclePlate}
                </p>
                <div className="mt-3">
                  <StatusBadge
                    label={
                      driver.status === 'AVAILABLE'
                        ? 'Available'
                        : driver.status === 'ON_DELIVERY'
                          ? 'On delivery'
                          : 'Offline'
                    }
                    tone={
                      driver.status === 'AVAILABLE'
                        ? 'success'
                        : driver.status === 'ON_DELIVERY'
                          ? 'warning'
                          : 'neutral'
                    }
                  />
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
        {orders.map((order) => (
          <Marker
            key={order.orderId}
            position={[order.lat, order.lng]}
            icon={orderIcon(order.status, selectedOrder?.orderId === order.orderId)}
            eventHandlers={{ click: () => onSelectOrder(order.orderId) }}
          >
            <Popup>
              <div className="min-w-48 font-sans">
                <p className="text-[9px] font-bold tracking-wider text-neutral-400 uppercase">
                  Delivery destination
                </p>
                <p className="mt-1 text-sm font-bold">{order.customerName}</p>
                <p className="mt-1 text-[10px] leading-4 text-neutral-500">
                  {formatLocationInEnglish(order.dropoffAddress)}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
        {connector.length === 2 && (
          <Polyline
            positions={connector}
            pathOptions={{ color: '#171717', opacity: 0.75, weight: 2, dashArray: '7 8' }}
          >
            <Tooltip sticky>Direct-distance preview · road routing not applied</Tooltip>
          </Polyline>
        )}
        <FocusViewport order={selectedOrder} driver={selectedDriver} />
      </MapContainer>
      <div className="pointer-events-none absolute bottom-4 left-4 z-[500] flex flex-wrap gap-3 rounded-xl border border-white/70 bg-white/92 px-3 py-2 shadow-lg backdrop-blur">
        <StatusBadge label="Available driver" tone="success" />
        <StatusBadge label="Busy driver" tone="warning" />
        <span className="flex items-center gap-2 text-[10px] font-semibold text-neutral-600">
          <span className="size-2 rotate-45 bg-neutral-950" />
          Destination
        </span>
      </div>
      {selectedOrder && (
        <div className="pointer-events-none absolute left-4 top-4 z-[500] rounded-xl border border-white/70 bg-neutral-950/92 px-4 py-3 text-white shadow-lg backdrop-blur">
          <p className="text-[8px] font-bold tracking-widest text-neutral-500 uppercase">
            Selected order
          </p>
          <p className="mt-1 font-mono text-xs font-bold">
            CF-{selectedOrder.orderId.slice(0, 8).toUpperCase()}
          </p>
        </div>
      )}
    </div>
  );
};

export const DispatchMap = memo(DispatchMapComponent);
