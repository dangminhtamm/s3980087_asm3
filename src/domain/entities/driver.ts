import {
  DRIVER_STATUSES,
  type DriverDto,
  type DriverLocationDto,
  type DriverStatus,
} from '../../../packages/contracts/index.js';

export { DRIVER_STATUSES, type DriverStatus };

export type Driver = DriverDto;

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

export type DriverLocation = DriverLocationDto;

export interface DriverLocationItem extends DriverLocation {
  PK: string;
  SK: string;
  expiresAt: number;
}
