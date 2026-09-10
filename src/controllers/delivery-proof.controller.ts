import type { NextFunction, Request, Response } from 'express';

import {
  orderIdParamsSchema,
  proofUploadQuerySchema,
  registerDeliveryProofSchema,
} from '../schemas/order.schema.js';
import type { DeliveryProofService } from '../services/delivery-proof.service.js';
import type { OrderService } from '../services/order.service.js';
import { createProofOfDeliveryUploadUrl } from '../utils/s3-presigned-url.js';
import { createProofOfDeliveryViewUrl } from '../utils/s3-presigned-url.js';

export class DeliveryProofController {
  public constructor(
    private readonly orderService: OrderService,
    private readonly proofService: DeliveryProofService,
  ) {}

  public createUploadUrl = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const { contentType } = proofUploadQuerySchema.parse(request.query);
      await this.orderService.assertCanUploadProof(id);
      const upload = await createProofOfDeliveryUploadUrl(id, contentType);
      response.status(200).json({ data: upload });
    } catch (error: unknown) {
      next(error);
    }
  };

  public registerProof = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const input = registerDeliveryProofSchema.parse(request.body);
      await this.orderService.assertCanUploadProof(id);
      const proof = await this.proofService.registerProof(
        id,
        input,
        request.authenticatedUser!.subject,
      );
      response.status(201).json({ data: proof });
    } catch (error: unknown) {
      next(error);
    }
  };

  public getProof = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const proof = await this.proofService.getProof(id);
      response.status(200).json({ data: proof });
    } catch (error: unknown) {
      next(error);
    }
  };

  public getViewUrl = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = orderIdParamsSchema.parse(request.params);
      const proof = await this.proofService.getProof(id);
      response.status(200).json({ data: await createProofOfDeliveryViewUrl(proof.objectKey) });
    } catch (error: unknown) {
      next(error);
    }
  };
}
