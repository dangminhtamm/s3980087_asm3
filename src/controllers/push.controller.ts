import type { NextFunction, Request, Response } from 'express';

import { driverIdParamsSchema } from '../schemas/driver.schema.js';
import { pushSubscriptionSchema } from '../schemas/push.schema.js';
import type { PushService } from '../services/push.service.js';

export class PushController {
  public constructor(private readonly push: PushService) {}

  public getPublicKey = (_request: Request, response: Response): void => {
    response.status(200).json({ data: { publicKey: this.push.getPublicKey() } });
  };

  public subscribe = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = driverIdParamsSchema.parse(request.params);
      response
        .status(201)
        .json({ data: await this.push.subscribe(id, pushSubscriptionSchema.parse(request.body)) });
    } catch (error: unknown) {
      next(error);
    }
  };

  public unsubscribe = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = driverIdParamsSchema.parse(request.params);
      const { endpoint } = pushSubscriptionSchema.pick({ endpoint: true }).parse(request.body);
      await this.push.unsubscribe(id, endpoint);
      response.status(204).send();
    } catch (error: unknown) {
      next(error);
    }
  };
}
