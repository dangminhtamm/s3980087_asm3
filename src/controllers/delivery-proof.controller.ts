import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendData } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type {
  orderIdParamsSchema,
  proofUploadQuerySchema,
  registerDeliveryProofSchema,
} from '../schemas/order.schema.js';
import type { DeliveryProofWorkflowService } from '../services/delivery-proof-workflow.service.js';

type OrderIdParams = z.infer<typeof orderIdParamsSchema>;
type ProofUploadQuery = z.infer<typeof proofUploadQuerySchema>;
type RegisterProofBody = z.infer<typeof registerDeliveryProofSchema>;

export class DeliveryProofController {
  public constructor(private readonly proofs: DeliveryProofWorkflowService) {}

  public createUploadUrl = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<OrderIdParams>(response, 'params');
    const { contentType } = validated<ProofUploadQuery>(response, 'query');
    sendData(response, 200, await this.proofs.createUploadUrl(id, contentType));
  };

  public registerProof = async (request: Request, response: Response): Promise<void> => {
    const { id } = validated<OrderIdParams>(response, 'params');
    sendData(
      response,
      201,
      await this.proofs.register(
        id,
        validated<RegisterProofBody>(response, 'body'),
        request.authenticatedUser!.subject,
      ),
    );
  };

  public getProof = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<OrderIdParams>(response, 'params');
    sendData(response, 200, await this.proofs.get(id));
  };

  public getViewUrl = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<OrderIdParams>(response, 'params');
    sendData(response, 200, await this.proofs.createViewUrl(id));
  };
}
