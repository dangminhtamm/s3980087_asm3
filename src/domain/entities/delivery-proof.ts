export const ALLOWED_PROOF_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ProofContentType = (typeof ALLOWED_PROOF_CONTENT_TYPES)[number];

export const MAX_PROOF_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export interface DeliveryProof {
  orderId: string;
  objectKey: string;
  contentType: ProofContentType;
  size: number;
  etag: string;
  uploadedBy: string;
  uploadedAt: string;
  recipientName: string | null;
  signatureDataUrl: string | null;
  barcode: string | null;
  notes: string | null;
  gps: ProofGpsLocation | null;
}

export interface ProofGpsLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  recordedAt: string;
}

export interface DeliveryProofItem extends DeliveryProof {
  PK: string;
  SK: 'PROOF#POD';
}

export interface RegisterDeliveryProofInput {
  objectKey: string;
  contentType: ProofContentType;
  size: number;
  recipientName?: string | undefined;
  signatureDataUrl?: string | undefined;
  barcode?: string | undefined;
  notes?: string | undefined;
  gps?: ProofGpsLocation | undefined;
}
