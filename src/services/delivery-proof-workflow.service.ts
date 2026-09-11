import type { S3Client } from '@aws-sdk/client-s3';

import type {
  DeliveryProof,
  ProofContentType,
  RegisterDeliveryProofInput,
} from '../domain/entities/delivery-proof.js';
import {
  createProofOfDeliveryUploadUrl,
  createProofOfDeliveryViewUrl,
  type PresignedProofView,
  type PresignedUpload,
} from '../utils/s3-presigned-url.js';
import type { DeliveryProofService } from './delivery-proof.service.js';
import type { OrderService } from './order.service.js';

export class DeliveryProofWorkflowService {
  public constructor(
    private readonly orders: OrderService,
    private readonly proofs: DeliveryProofService,
    private readonly presignClient: S3Client,
    private readonly bucket: string,
  ) {}

  public async createUploadUrl(
    orderId: string,
    contentType: ProofContentType,
  ): Promise<PresignedUpload> {
    await this.orders.assertCanUploadProof(orderId);
    return createProofOfDeliveryUploadUrl(this.presignClient, this.bucket, orderId, contentType);
  }

  public async register(
    orderId: string,
    input: RegisterDeliveryProofInput,
    actorId: string,
  ): Promise<DeliveryProof> {
    await this.orders.assertCanUploadProof(orderId);
    return this.proofs.registerProof(orderId, input, actorId);
  }

  public get(orderId: string): Promise<DeliveryProof> {
    return this.proofs.getProof(orderId);
  }

  public async createViewUrl(orderId: string): Promise<PresignedProofView> {
    const proof = await this.proofs.getProof(orderId);
    return createProofOfDeliveryViewUrl(this.presignClient, this.bucket, proof.objectKey);
  }
}
