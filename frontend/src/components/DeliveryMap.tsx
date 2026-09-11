import { Icon, latLngBounds } from 'leaflet';
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { memo, useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';

import type { DeliveryMapProps, MapCoordinate } from '../types/map';

// OSM's current tile policy requires this canonical, non-subdomain URL.
const OPEN_STREET_MAP_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const EMPTY_ROUTE_PATH: MapCoordinate[] = [];

/**
 * Vite fingerprints imported images and returns their final public URLs.
 * Passing those URLs explicitly prevents Leaflet's default path detection from
 * looking for marker images beside the generated JavaScript bundle.
 */
const deliveryMarkerIcon = new Icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const driverMarkerIcon = new Icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: 'cloudfleet-driver-marker',
});

interface MapViewportProps {
  positions: MapCoordinate[];
}

/** Keeps the viewport in sync because MapContainer options are immutable. */
const MapViewport = ({ positions }: MapViewportProps) => {
  const map = useMap();

  useEffect(() => {
    // The map is rendered inside a lazy route and a responsive grid. Re-read
    // its final dimensions before changing the viewport so Leaflet does not
    // retain the zero/stale size measured during the first layout pass.
    map.invalidateSize({ pan: false });

    if (positions.length === 1) {
      map.setView(positions[0]!, 16, { animate: false });
      return;
    }

    map.fitBounds(latLngBounds(positions), {
      animate: true,
      maxZoom: 16,
      padding: [48, 48],
    });
  }, [map, positions]);

  return null;
};

const DeliveryMapComponent = ({
  orderLocation,
  driverLocation = null,
  routePath = EMPTY_ROUTE_PATH,
  address,
}: DeliveryMapProps) => {
  const viewportPositions = useMemo<MapCoordinate[]>(
    () => [orderLocation, ...(driverLocation ? [driverLocation] : []), ...routePath],
    [driverLocation, orderLocation, routePath],
  );

  return (
    <MapContainer
      center={orderLocation}
      zoom={16}
      scrollWheelZoom={false}
      className="cloudfleet-delivery-map"
      aria-label="Delivery location map"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url={OPEN_STREET_MAP_URL}
        maxZoom={19}
      />

      {routePath.length >= 2 && (
        <Polyline
          positions={routePath}
          pathOptions={{ color: '#0f766e', opacity: 0.8, weight: 4 }}
        />
      )}

      {driverLocation && (
        <Marker
          position={driverLocation}
          icon={driverMarkerIcon}
          title="Driver's current location"
          zIndexOffset={500}
        >
          <Popup>Driver's current location</Popup>
        </Marker>
      )}

      <Marker position={orderLocation} icon={deliveryMarkerIcon} title={address}>
        <Popup>{address}</Popup>
      </Marker>

      <MapViewport positions={viewportPositions} />
    </MapContainer>
  );
};

export const DeliveryMap = memo(DeliveryMapComponent);
