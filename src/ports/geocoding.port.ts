export interface GeocodingCandidate {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  region: string | null;
  importance: number;
}

export interface GeocodingPort {
  validate(address: string, countryCode: string, limit: number): Promise<GeocodingCandidate[]>;
}
