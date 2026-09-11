import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendData, sendEmpty } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type { driverIdParamsSchema } from '../schemas/driver.schema.js';
import type { pushSubscriptionSchema, pushUnsubscribeSchema } from '../schemas/push.schema.js';
import type { PushService } from '../services/push.service.js';

type DriverIdParams = z.infer<typeof driverIdParamsSchema>;
type PushSubscriptionBody = z.infer<typeof pushSubscriptionSchema>;
type PushUnsubscribeBody = z.infer<typeof pushUnsubscribeSchema>;

export class PushController {
  public constructor(private readonly push: PushService) {}

  public getPublicKey = (_request: Request, response: Response): void => {
    sendData(response, 200, { publicKey: this.push.getPublicKey() });
  };

  public subscribe = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<DriverIdParams>(response, 'params');
    sendData(
      response,
      201,
      await this.push.subscribe(id, validated<PushSubscriptionBody>(response, 'body')),
    );
  };

  public unsubscribe = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<DriverIdParams>(response, 'params');
    const { endpoint } = validated<PushUnsubscribeBody>(response, 'body');
    await this.push.unsubscribe(id, endpoint);
    sendEmpty(response, 204);
  };
}
