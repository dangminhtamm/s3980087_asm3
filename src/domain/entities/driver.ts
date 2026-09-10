export const DRIVER_STATUSES = ['AVAILABLE', 'ON_DELIVERY', 'OFFLINE'] as const;

export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export interface Driver {
  driverId: string;
  name: string;
  phone: string;
  vehiclePlate: string;
  currentArea: string;
  status: DriverStatus;
  completedToday: number;
  lat: number | null;
  lng: number | null;
  locationUpdatedAt: string | null;
  updatedAt: string;
  maxWeightKg: number;
  maxVolumeM3: number;
}

export interface CreateDriverInput {
  name: string;
  phone: string;
  vehiclePlate: string;
  currentArea: string;
  maxWeightKg?: number | undefined;
  maxVolumeM3?: number | undefined;
}

export interface DriverItem extends Driver {
  PK: string;
  SK: 'PROFILE';
  GSI2PK: string;
  GSI2SK: string;
}

export interface UpdateDriverLocationInput {
  lat: number;
  lng: number;
  accuracy?: number | undefined;
  recordedAt?: string | undefined;
}

export interface DriverLocation {
  driverId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: string;
}

export interface DriverLocationItem extends DriverLocation {
  PK: string;
  SK: string;
  expiresAt: number;
}
