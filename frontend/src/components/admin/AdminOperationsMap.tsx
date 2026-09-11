import { DivIcon, latLngBounds } from 'leaflet';
import { memo, useEffect, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';

import type { AdminOrder, DriverStatus, FleetDriver } from '../../types/admin';
import type { MapCoordinate } from '../../types/map';
import { formatLocationInEnglish } from '../../utils/location';
import { StatusBadge } from '../ui';

const OPEN_STREET_MAP_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_CENTER: MapCoordinate = [10.7769, 106.7009];

const driverIcon = (status: DriverStatus): DivIcon =>
  new DivIcon({
    className: 'cloudfleet-map-icon',
    html: `<span class="cloudfleet-map-driver cloudfleet-map-driver--${status.toLowerCase().replace('_', '-')}"><span></span></span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -17],
  });

const destinationIcon = new DivIcon({
  className: 'cloudfleet-map-icon',
  html: '<span class="cloudfleet-map-destination"><span></span></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -15],
});

const driverIcons: Record<DriverStatus, DivIcon> = {
  AVAILABLE: driverIcon('AVAILABLE'),
  ON_DELIVERY: driverIcon('ON_DELIVERY'),
  OFFLINE: driverIcon('OFFLINE'),
};

const MapViewport = ({ positions }: { positions: MapCoordinate[] }) => {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize({ pan: false });
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0]!, 14, { animate: true });
      return;
    }
    map.fitBounds(latLngBounds(positions), { animate: true, maxZoom: 14, padding: [42, 42] });
  }, [map, positions]);
  return null;
};

interface AdminOperationsMapProps {
  drivers: FleetDriver[];
  activeOrders: AdminOrder[];
}

const AdminOperationsMapComponent = ({ drivers, activeOrders }: AdminOperationsMapProps) => {
  const locatedDrivers = useMemo(
    () => drivers.filter((driver) => driver.lat !== null && driver.lng !== null),
    [drivers],
  );
  const positions = useMemo<MapCoordinate[]>(
    () => [
      ...locatedDrivers.map((driver) => [driver.lat!, driver.lng!] as MapCoordinate),
      ...activeOrders.map((order) => [order.lat, order.lng] as MapCoordinate),
    ],
    [activeOrders, locatedDrivers],
  );

  return (
    <div className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-200">
      <MapContainer
        center={positions[0] ?? DEFAULT_CENTER}
        zoom={13}
        scrollWheelZoom
        className="cloudfleet-control-map"
        aria-label="Live fleet operations map"
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
            icon={driverIcons[driver.status]}
            zIndexOffset={500}
          >
            <Popup>
              <div className="min-w-44 font-sans">
                <p className="text-sm font-bold">{driver.name}</p>
                <p className="mt-1 text-[11px] text-neutral-500">
                  {driver.driverId} · {driver.vehiclePlate}
                </p>
                <div className="mt-3">
                  <StatusBadge
                    label={
                      driver.status === 'ON_DELIVERY'
                        ? 'On delivery'
                        : driver.status === 'AVAILABLE'
                          ? 'Available'
                          : 'Offline'
                    }
                    tone={
                      driver.status === 'ON_DELIVERY'
                        ? 'warning'
                        : driver.status === 'AVAILABLE'
                          ? 'success'
                          : 'neutral'
                    }
                  />
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
        {activeOrders.map((order) => (
          <Marker key={order.orderId} position={[order.lat, order.lng]} icon={destinationIcon}>
            <Popup>
              <div className="min-w-48 font-sans">
                <p className="text-[9px] font-bold tracking-wider text-neutral-400 uppercase">
                  Active destination
                </p>
                <p className="mt-1 text-sm font-bold">{order.customerName}</p>
                <p className="mt-1 text-[11px] leading-4 text-neutral-500">
                  {formatLocationInEnglish(order.dropoffAddress)}
                </p>
                <p className="mt-2 font-mono text-[10px]">
                  CF-{order.orderId.slice(0, 8).toUpperCase()}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
        <MapViewport positions={positions} />
      </MapContainer>
      <div className="pointer-events-none absolute bottom-4 left-4 z-[500] flex flex-wrap gap-2 rounded-xl border border-white/70 bg-white/92 px-3 py-2 shadow-lg backdrop-blur">
        <StatusBadge label="Available" tone="success" />
        <StatusBadge label="On delivery" tone="warning" />
        <StatusBadge label="Offline" tone="neutral" />
        <span className="flex items-center gap-2 text-[10px] font-semibold text-neutral-600">
          <span className="size-2 rotate-45 bg-neutral-950" />
          Destination
        </span>
      </div>
    </div>
  );
};

export const AdminOperationsMap = memo(AdminOperationsMapComponent);
