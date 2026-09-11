import type { Request, Response } from 'express';
import type { z } from 'zod';

import { sendData } from '../http/response.js';
import { validated } from '../middlewares/validation.js';
import type {
  createDriverSchema,
  driverIdParamsSchema,
  listDriversQuerySchema,
  updateDriverLocationSchema,
  updateDriverStatusSchema,
} from '../schemas/driver.schema.js';
import type { DriverService } from '../services/driver.service.js';

type DriverIdParams = z.infer<typeof driverIdParamsSchema>;
type CreateDriverBody = z.infer<typeof createDriverSchema>;
type ListDriversQuery = z.infer<typeof listDriversQuerySchema>;
type UpdateDriverStatusBody = z.infer<typeof updateDriverStatusSchema>;
type UpdateDriverLocationBody = z.infer<typeof updateDriverLocationSchema>;

export class DriverController {
  public constructor(private readonly drivers: DriverService) {}

  public listDrivers = async (_request: Request, response: Response): Promise<void> => {
    const { status, limit } = validated<ListDriversQuery>(response, 'query');
    sendData(response, 200, await this.drivers.listDrivers(status, limit));
  };

  public createDriver = async (_request: Request, response: Response): Promise<void> => {
    sendData(
      response,
      201,
      await this.drivers.createDriver(validated<CreateDriverBody>(response, 'body')),
    );
  };

  public getDriver = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<DriverIdParams>(response, 'params');
    sendData(response, 200, await this.drivers.getDriver(id));
  };

  public updateStatus = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<DriverIdParams>(response, 'params');
    const { status } = validated<UpdateDriverStatusBody>(response, 'body');
    sendData(response, 200, await this.drivers.updateStatus(id, status));
  };

  public updateLocation = async (_request: Request, response: Response): Promise<void> => {
    const { id } = validated<DriverIdParams>(response, 'params');
    sendData(
      response,
      200,
      await this.drivers.updateLocation(id, validated<UpdateDriverLocationBody>(response, 'body')),
    );
  };
}
