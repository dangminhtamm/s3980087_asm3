import {
  ALLOWED_PROOF_CONTENT_TYPES,
  type DeliveryProof,
  type ProofContentType,
  type ProofGpsLocation,
} from '../../../packages/contracts/index.js';

export {
  ALLOWED_PROOF_CONTENT_TYPES,
  type DeliveryProof,
  type ProofContentType,
  type ProofGpsLocation,
};

export const MAX_PROOF_FILE_SIZE_BYTES = 10 * 1024 * 1024;

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
