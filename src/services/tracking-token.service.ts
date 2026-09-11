import type { TrackingLink } from '../domain/entities/tracking.js';
import { AppError } from '../errors/app-error.js';
import type { ClockPort } from '../ports/clock.port.js';
import { systemClock } from '../ports/clock.port.js';
import type {
  TrackingTokenRecord,
  TrackingTokenStorePort,
} from '../ports/tracking-token-store.port.js';
import {
  generateTrackingToken,
  hashTrackingToken,
  TRACKING_TOKEN_TTL_SECONDS,
} from '../utils/tracking-token.js';

export class TrackingTokenService {
  public constructor(
    private readonly store: TrackingTokenStorePort,
    private readonly trackingBaseUrl: string | null,
    private readonly clock: ClockPort = systemClock,
    private readonly generateToken: () => string = generateTrackingToken,
  ) {}

  public issue(): TrackingTokenRecord {
    const token = this.generateToken();
    return {
      token,
      tokenHash: hashTrackingToken(token),
      expiresAt: Math.floor(this.clock.now().getTime() / 1000) + TRACKING_TOKEN_TTL_SECONDS,
    };
  }

  public async ensure(orderId: string): Promise<TrackingTokenRecord> {
    const current = await this.store.findTrackingToken(orderId);
    if (current && current.expiresAt > Math.floor(this.clock.now().getTime() / 1000))
      return current;

    const replacement = this.issue();
    await this.store.saveTrackingToken(orderId, replacement);
    return replacement;
  }

  public async link(orderId: string): Promise<TrackingLink> {
    if (!this.trackingBaseUrl)
      throw new AppError(503, 'Customer tracking URL is not configured', 'TRACKING_NOT_CONFIGURED');

    const record = await this.ensure(orderId);
    return {
      url: `${this.trackingBaseUrl.replace(/\/$/, '')}/track/${encodeURIComponent(record.token)}`,
      expiresAt: new Date(record.expiresAt * 1000).toISOString(),
    };
  }
}
