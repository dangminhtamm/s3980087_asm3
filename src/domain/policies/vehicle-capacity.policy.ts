import type { Order } from '../entities/order.js';
import { AppError } from '../../errors/app-error.js';

export interface VehicleCapacity {
  maxWeightKg: number;
  maxVolumeM3: number;
}

const ACTIVE_CAPACITY_STATUSES = new Set(['ASSIGNED', 'IN_PROGRESS', 'ARRIVED', 'RETURNING']);

export class VehicleCapacityPolicy {
  public assertFits(
    capacity: VehicleCapacity,
    current: Order[],
    selected: Order[],
    scope: 'assignment' | 'route' = 'assignment',
  ): void {
    const active = current.filter((order) => ACTIVE_CAPACITY_STATUSES.has(order.status));
    const load = [...active, ...selected].reduce(
      (total, order) => ({
        weightKg: total.weightKg + order.packageWeightKg,
        volumeM3: total.volumeM3 + order.packageVolumeM3,
      }),
      { weightKg: 0, volumeM3: 0 },
    );

    if (load.weightKg <= capacity.maxWeightKg && load.volumeM3 <= capacity.maxVolumeM3) return;

    throw new AppError(
      409,
      scope === 'route'
        ? 'The route exceeds vehicle capacity'
        : 'The assignment exceeds vehicle capacity',
      'VEHICLE_CAPACITY_EXCEEDED',
      {
        requested: load,
        capacity: { weightKg: capacity.maxWeightKg, volumeM3: capacity.maxVolumeM3 },
      },
    );
  }
}
