import { DivIcon, latLngBounds } from 'leaflet';
import { memo, useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';

import type { MapCoordinate } from '../../types/map';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const destinationIcon = new DivIcon({ className: 'cloudfleet-map-icon', html: '<span class="cloudfleet-map-destination"><span></span></span>', iconSize: [28, 28], iconAnchor: [14, 14] });
const driverIcon = new DivIcon({ className: 'cloudfleet-map-icon', html: '<span class="cloudfleet-map-driver cloudfleet-map-driver--on-delivery"><span></span></span>', iconSize: [32, 32], iconAnchor: [16, 16] });

const Viewport = ({ positions }: { positions: MapCoordinate[] }) => {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize({ pan: false });
    if (positions.length === 1) map.setView(positions[0]!, 15);
    else if (positions.length > 1) map.fitBounds(latLngBounds(positions), { padding: [50, 50], maxZoom: 15 });
  }, [map, positions]);
  return null;
};

interface DetailLocationMapProps {
  destination?: { position: MapCoordinate; label: string } | null;
  driver?: { position: MapCoordinate; label: string } | null;
}

const DetailLocationMapComponent = ({ destination = null, driver = null }: DetailLocationMapProps) => {
  const positions = useMemo(() => [destination?.position, driver?.position].filter((position): position is MapCoordinate => Boolean(position)), [destination, driver]);
  const center = positions[0] ?? [10.7769, 106.7009] as MapCoordinate;
  return <MapContainer center={center} zoom={14} scrollWheelZoom={false} className="cloudfleet-detail-map" aria-label="Location map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url={TILE_URL} maxZoom={19} />{destination && <Marker position={destination.position} icon={destinationIcon}><Popup>{destination.label}</Popup></Marker>}{driver && <Marker position={driver.position} icon={driverIcon} zIndexOffset={500}><Popup>{driver.label}</Popup></Marker>}{destination && driver && <Polyline positions={[driver.position, destination.position]} pathOptions={{ color: '#171717', weight: 2, opacity: 0.65, dashArray: '7 8' }} />}<Viewport positions={positions} /></MapContainer>;
};

export const DetailLocationMap = memo(DetailLocationMapComponent);
