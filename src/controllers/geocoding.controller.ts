import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendData } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type { GeocodingPort } from '../ports/geocoding.port.js';
import type { validateAddressSchema } from '../schemas/geocoding.schema.js';

type ValidateAddressBody = z.infer<typeof validateAddressSchema>;

export class GeocodingController {
  public constructor(private readonly geocoding: GeocodingPort) {}

  public validate = async (_request: Request, response: Response): Promise<void> => {
    const input = validated<ValidateAddressBody>(response, 'body');
    const candidates = await this.geocoding.validate(input.address, input.countryCode, input.limit);
    sendData(response, 200, { valid: candidates.length > 0, candidates });
  };
}
