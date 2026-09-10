import { AppError } from '../errors/app-error.js';

export interface GeocodingCandidate {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  region: string | null;
  importance: number;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  importance?: number;
  address?: { city?: string; town?: string; county?: string; state?: string };
}

export class GeocodingService {
  private readonly cache = new Map<string, { expiresAt: number; data: GeocodingCandidate[] }>();
  private nextRequestAt = 0;

  public constructor(
    private readonly provider = process.env.GEOCODING_PROVIDER?.trim() || 'disabled',
    private readonly baseUrl = process.env.GEOCODING_BASE_URL?.trim() || 'https://nominatim.openstreetmap.org',
    private readonly userAgent = process.env.GEOCODING_USER_AGENT?.trim() || 'CloudFleet/0.1',
    private readonly minIntervalMs = Number(process.env.GEOCODING_MIN_INTERVAL_MS ?? '1000'),
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async validate(address: string, countryCode: string, limit: number): Promise<GeocodingCandidate[]> {
    if (this.provider !== 'nominatim') {
      throw new AppError(503, 'Address validation is not configured', 'GEOCODING_NOT_CONFIGURED');
    }
    const cacheKey = `${countryCode}:${limit}:${address}`.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const waitMs = Math.max(0, this.nextRequestAt - Date.now());
    if (waitMs) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    this.nextRequestAt = Date.now() + Math.max(0, this.minIntervalMs);

    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', address);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', countryCode);
    url.searchParams.set('limit', String(limit));
    const response = await this.fetcher(url, {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new AppError(502, 'Geocoding provider is unavailable', 'GEOCODING_PROVIDER_ERROR');
    const raw = await response.json() as NominatimResult[];
    const data = raw.map((result) => ({
      placeId: String(result.place_id), formattedAddress: result.display_name,
      lat: Number(result.lat), lng: Number(result.lon),
      region: result.address?.city ?? result.address?.town ?? result.address?.county ?? result.address?.state ?? null,
      importance: result.importance ?? 0,
    })).filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lng));
    this.cache.set(cacheKey, { expiresAt: Date.now() + 24 * 60 * 60 * 1000, data });
    return data;
  }
}
