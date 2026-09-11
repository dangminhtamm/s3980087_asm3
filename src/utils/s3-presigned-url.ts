import { randomUUID } from 'node:crypto';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { DELIVERY_PROOF_BUCKET, s3PresignClient } from '../config/s3.js';
import type { ProofContentType } from '../domain/entities/delivery-proof.js';

const FILE_EXTENSIONS: Record<ProofContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const UPLOAD_URL_EXPIRY_SECONDS = 300;
const VIEW_URL_EXPIRY_SECONDS = 300;

export interface PresignedUpload {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
  requiredHeaders: {
    'Content-Type': ProofContentType;
    'x-amz-meta-orderid': string;
  };
}

/**
 * Creates a short-lived PUT URL so the browser uploads proof images directly
 * to S3. The Content-Type is signed and must be sent unchanged by the frontend.
 */
export const createProofOfDeliveryUploadUrl = async (
  orderId: string,
  contentType: ProofContentType,
): Promise<PresignedUpload> => {
  const objectKey = [
    'proof-of-delivery',
    orderId,
    `${randomUUID()}.${FILE_EXTENSIONS[contentType]}`,
  ].join('/');

  const command = new PutObjectCommand({
    Bucket: DELIVERY_PROOF_BUCKET,
    Key: objectKey,
    ContentType: contentType,
    Metadata: { orderid: orderId },
  });

  const uploadUrl = await getSignedUrl(s3PresignClient, command, {
    expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
    // Keep the order metadata as a signed request header. Without this option,
    // the SDK may hoist it into the query string; sending it again from the
    // browser is then rejected by strict S3-compatible servers such as MinIO.
    unhoistableHeaders: new Set(['x-amz-meta-orderid']),
  });

  return {
    uploadUrl,
    objectKey,
    expiresIn: UPLOAD_URL_EXPIRY_SECONDS,
    requiredHeaders: {
      'Content-Type': contentType,
      'x-amz-meta-orderid': orderId,
    },
  };
};

export interface PresignedProofView {
  viewUrl: string;
  expiresIn: number;
}

/** Creates a short-lived read URL; the proof bucket remains private. */
export const createProofOfDeliveryViewUrl = async (
  objectKey: string,
): Promise<PresignedProofView> => ({
  viewUrl: await getSignedUrl(
    s3PresignClient,
    new GetObjectCommand({ Bucket: DELIVERY_PROOF_BUCKET, Key: objectKey }),
    { expiresIn: VIEW_URL_EXPIRY_SECONDS },
  ),
  expiresIn: VIEW_URL_EXPIRY_SECONDS,
});
