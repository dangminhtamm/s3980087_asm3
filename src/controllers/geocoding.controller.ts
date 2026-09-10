import type { NextFunction, Request, Response } from 'express';

import { validateAddressSchema } from '../schemas/geocoding.schema.js';
import type { GeocodingService } from '../services/geocoding.service.js';

export class GeocodingController {
  public constructor(private readonly geocoding: GeocodingService) {}

  public validate = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const input = validateAddressSchema.parse(request.body);
      const candidates = await this.geocoding.validate(input.address, input.countryCode, input.limit);
      response.status(200).json({ data: { valid: candidates.length > 0, candidates } });
    } catch (error: unknown) { next(error); }
  };
}
