import { createHash, randomBytes } from 'node:crypto';

export const TRACKING_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** 256 bits of entropy; base64url is safe inside both SMS links and route params. */
export const generateTrackingToken = (): string => randomBytes(32).toString('base64url');

export const hashTrackingToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const trackingExpiry = (now = new Date()): number =>
  Math.floor(now.getTime() / 1000) + TRACKING_TOKEN_TTL_SECONDS;
