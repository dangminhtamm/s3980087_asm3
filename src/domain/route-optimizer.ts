import type { Order } from './entities/order.js';

interface RoutingPoint {
  lat: number;
  lng: number;
}

export interface RoutingMatrix {
  durations: number[][];
  distances: number[][];
  provider: string;
}

const haversineMeters = (left: RoutingPoint, right: RoutingPoint): number => {
  const radius = 6_371_000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat = radians(right.lat - left.lat);
  const lng = radians(right.lng - left.lng);
  const value =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(left.lat)) * Math.cos(radians(right.lat)) * Math.sin(lng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
};

export const fallbackRoutingMatrix = (points: RoutingPoint[]): RoutingMatrix => {
  const distances = points.map((origin) =>
    points.map((destination) => Math.round(haversineMeters(origin, destination) * 1.25)),
  );
  return {
    distances,
    durations: distances.map((row) =>
      row.map((distance) => Math.round(distance / (25_000 / 3600))),
    ),
    provider: 'straight-line-fallback',
  };
};

const scoreOrder = (
  order: number[],
  matrix: RoutingMatrix,
  orders: Order[],
  departureMs: number,
): number => {
  let cursor = departureMs;
  let previous = 0;
  let score = 0;
  for (const pointIndex of order) {
    const target = orders[pointIndex - 1]!;
    const travel = matrix.durations[previous]?.[pointIndex] ?? Number.MAX_SAFE_INTEGER;
    cursor += travel * 1000;
    const windowStart = target.timeWindowStart ? Date.parse(target.timeWindowStart) : null;
    const windowEnd = target.timeWindowEnd ? Date.parse(target.timeWindowEnd) : null;
    if (windowStart && cursor < windowStart) cursor = windowStart;
    const lateSeconds = windowEnd && cursor > windowEnd ? (cursor - windowEnd) / 1000 : 0;
    score += travel + lateSeconds * 20;
    cursor += target.serviceDurationMinutes * 60_000;
    previous = pointIndex;
  }
  return score;
};

export const optimizeSequence = (
  matrix: RoutingMatrix,
  orders: Order[],
  departureAt: string,
): number[] => {
  const remaining = new Set(orders.map((_, index) => index + 1));
  const sequence: number[] = [];
  let previous = 0;
  let cursor = Date.parse(departureAt);
  while (remaining.size) {
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of remaining) {
      const order = orders[candidate - 1]!;
      const travel = matrix.durations[previous]?.[candidate] ?? Number.MAX_SAFE_INTEGER;
      const arrival = cursor + travel * 1000;
      const late = order.timeWindowEnd
        ? Math.max(0, arrival - Date.parse(order.timeWindowEnd)) / 1000
        : 0;
      const wait = order.timeWindowStart
        ? Math.max(0, Date.parse(order.timeWindowStart) - arrival) / 1000
        : 0;
      const candidateScore = travel + late * 20 + wait * 0.05;
      if (candidateScore < bestScore) {
        best = candidate;
        bestScore = candidateScore;
      }
    }
    sequence.push(best);
    remaining.delete(best);
    const selected = orders[best - 1]!;
    cursor += (matrix.durations[previous]?.[best] ?? 0) * 1000;
    if (selected.timeWindowStart) cursor = Math.max(cursor, Date.parse(selected.timeWindowStart));
    cursor += selected.serviceDurationMinutes * 60_000;
    previous = best;
  }

  let best = sequence;
  let bestScore = scoreOrder(best, matrix, orders, Date.parse(departureAt));
  for (let pass = 0; pass < 3; pass += 1) {
    let improved = false;
    for (let left = 0; left < best.length - 1; left += 1)
      for (let right = left + 1; right < best.length; right += 1) {
        const candidate = [
          ...best.slice(0, left),
          ...best.slice(left, right + 1).reverse(),
          ...best.slice(right + 1),
        ];
        const candidateScore = scoreOrder(candidate, matrix, orders, Date.parse(departureAt));
        if (candidateScore < bestScore) {
          best = candidate;
          bestScore = candidateScore;
          improved = true;
        }
      }
    if (!improved) break;
  }
  return best;
};
