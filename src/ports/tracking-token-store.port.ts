export interface TrackingTokenRecord {
  token: string;
  tokenHash: string;
  expiresAt: number;
}

export interface TrackingTokenStorePort {
  findTrackingToken(orderId: string): Promise<TrackingTokenRecord | null>;
  saveTrackingToken(orderId: string, record: TrackingTokenRecord): Promise<void>;
}
