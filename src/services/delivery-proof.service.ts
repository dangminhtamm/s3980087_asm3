import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  GetCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import {
  ALLOWED_PROOF_CONTENT_TYPES,
  MAX_PROOF_FILE_SIZE_BYTES,
  type DeliveryProof,
  type DeliveryProofItem,
  type ProofContentType,
  type RegisterDeliveryProofInput,
} from '../domain/entities/delivery-proof.js';
import { AppError } from '../errors/app-error.js';
import { createOrderEventItem } from '../domain/entities/order-event.js';
import { durationMsSince, emitMetrics } from '../observability/metrics.js';

const isProofContentType = (value: unknown): value is ProofContentType =>
  typeof value === 'string' &&
  ALLOWED_PROOF_CONTENT_TYPES.some((contentType) => contentType === value);

export class DeliveryProofService {
  public constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly storage: S3Client,
    private readonly bucketName: string,
  ) {}

  public async registerProof(
    orderId: string,
    input: RegisterDeliveryProofInput,
    uploadedBy: string,
  ): Promise<DeliveryProof> {
    const startedAt = process.hrtime.bigint();
    try {
      const proof = await this.performRegistration(orderId, input, uploadedBy);
      emitMetrics([
        { name: 'ProofRegisterDuration', value: durationMsSince(startedAt), unit: 'Milliseconds' },
        { name: 'ProofRegisterCount', value: 1, unit: 'Count' },
      ], { Outcome: 'success' });
      return proof;
    } catch (error: unknown) {
      emitMetrics([
        { name: 'ProofRegisterDuration', value: durationMsSince(startedAt), unit: 'Milliseconds' },
        { name: 'ProofRegisterCount', value: 1, unit: 'Count' },
        { name: 'ProofRegisterErrorCount', value: 1, unit: 'Count' },
      ], { Outcome: 'error' }, {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }

  private async performRegistration(
    orderId: string,
    input: RegisterDeliveryProofInput,
    uploadedBy: string,
  ): Promise<DeliveryProof> {
    const expectedPrefix = `proof-of-delivery/${orderId}/`;

    if (!input.objectKey.startsWith(expectedPrefix)) {
      throw new AppError(
        400,
        'Proof object key does not belong to this order',
        'INVALID_PROOF_OBJECT_KEY',
      );
    }

    let object;
    const verifyStartedAt = process.hrtime.bigint();
    try {
      object = await this.storage.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: input.objectKey,
        }),
      );
      emitMetrics([{ name: 'S3ProofVerifyDuration', value: durationMsSince(verifyStartedAt), unit: 'Milliseconds' }], {
        Outcome: 'success',
      });
    } catch (error: unknown) {
      emitMetrics([
        { name: 'S3ProofVerifyDuration', value: durationMsSince(verifyStartedAt), unit: 'Milliseconds' },
        { name: 'S3ProofVerifyErrorCount', value: 1, unit: 'Count' },
      ], { Outcome: 'error' }, {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      if (
        error instanceof Error &&
        ['NotFound', 'NoSuchKey', 'Forbidden'].includes(error.name)
      ) {
        throw new AppError(
          409,
          'The proof image is not available in storage',
          'PROOF_OBJECT_NOT_FOUND',
        );
      }
      throw error;
    }
    const storedContentType = object.ContentType?.toLowerCase();
    const storedSize = object.ContentLength;
    const storedOrderId = object.Metadata?.orderid;

    if (
      storedContentType !== input.contentType ||
      storedSize !== input.size ||
      storedOrderId !== orderId
    ) {
      throw new AppError(
        409,
        'Uploaded proof metadata does not match the registration request',
        'PROOF_METADATA_MISMATCH',
      );
    }

    if (!storedSize || storedSize > MAX_PROOF_FILE_SIZE_BYTES) {
      throw new AppError(
        413,
        'Proof image must be between 1 byte and 10 MB',
        'PROOF_FILE_SIZE_INVALID',
      );
    }

    const proof: DeliveryProof = {
      orderId,
      objectKey: input.objectKey,
      contentType: input.contentType,
      size: storedSize,
      etag: object.ETag?.replaceAll('"', '') || 'unknown',
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      recipientName: input.recipientName ?? null,
      signatureDataUrl: input.signatureDataUrl ?? null,
      barcode: input.barcode ?? null,
      notes: input.notes ?? null,
      gps: input.gps ?? null,
    };
    const item: DeliveryProofItem = {
      PK: `ORDER#${orderId}`,
      SK: 'PROOF#POD',
      ...proof,
    };

    await this.database.send(new TransactWriteCommand({ TransactItems: [
      { Put: { TableName: this.tableName, Item: item } },
      { Put: { TableName: this.tableName, Item: createOrderEventItem({ orderId, type: 'PROOF_UPLOADED', occurredAt: proof.uploadedAt, actorId: uploadedBy, metadata: {
        objectKey: proof.objectKey,
        contentType: proof.contentType,
        signatureCaptured: String(Boolean(proof.signatureDataUrl)),
        barcodeCaptured: String(Boolean(proof.barcode)),
        gpsCaptured: String(Boolean(proof.gps)),
      } }) } },
    ] }));

    return proof;
  }

  public async getProof(orderId: string): Promise<DeliveryProof> {
    const result = await this.database.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `ORDER#${orderId}`, SK: 'PROOF#POD' },
        ConsistentRead: true,
      }),
    );

    if (!result.Item) {
      throw new AppError(
        404,
        'Delivery proof not found',
        'DELIVERY_PROOF_NOT_FOUND',
      );
    }

    return this.toProof(result.Item);
  }

  private toProof(item: Record<string, unknown>): DeliveryProof {
    if (
      typeof item.orderId !== 'string' ||
      typeof item.objectKey !== 'string' ||
      !isProofContentType(item.contentType) ||
      typeof item.size !== 'number' ||
      typeof item.etag !== 'string' ||
      typeof item.uploadedBy !== 'string' ||
      typeof item.uploadedAt !== 'string'
    ) {
      throw new Error('Stored delivery proof is invalid');
    }

    return {
      orderId: item.orderId,
      objectKey: item.objectKey,
      contentType: item.contentType,
      size: item.size,
      etag: item.etag,
      uploadedBy: item.uploadedBy,
      uploadedAt: item.uploadedAt,
      recipientName: typeof item.recipientName === 'string' ? item.recipientName : null,
      signatureDataUrl: typeof item.signatureDataUrl === 'string' ? item.signatureDataUrl : null,
      barcode: typeof item.barcode === 'string' ? item.barcode : null,
      notes: typeof item.notes === 'string' ? item.notes : null,
      gps: this.toGps(item.gps),
    };
  }

  private toGps(value: unknown): DeliveryProof['gps'] {
    if (value === undefined || value === null) return null;
    if (
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof (value as Record<string, unknown>).lat !== 'number' ||
      typeof (value as Record<string, unknown>).lng !== 'number' ||
      typeof (value as Record<string, unknown>).recordedAt !== 'string'
    ) throw new Error('Stored delivery proof has invalid GPS data');
    const gps = value as Record<string, unknown>;
    return {
      lat: gps.lat as number,
      lng: gps.lng as number,
      accuracy: typeof gps.accuracy === 'number' ? gps.accuracy : null,
      recordedAt: gps.recordedAt as string,
    };
  }
}
