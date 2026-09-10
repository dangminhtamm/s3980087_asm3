import type { NextFunction, Request, Response } from 'express';

import {
  createDriverSchema,
  driverIdParamsSchema,
  listDriversQuerySchema,
  updateDriverStatusSchema,
  updateDriverLocationSchema,
} from '../schemas/driver.schema.js';
import type { DriverService } from '../services/driver.service.js';

export class DriverController {
  public constructor(private readonly driverService: DriverService) {}

  public listDrivers = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { status, limit } = listDriversQuerySchema.parse(request.query);
      const drivers = await this.driverService.listDrivers(status, limit);
      response.status(200).json({ data: drivers });
    } catch (error: unknown) {
      next(error);
    }
  };

  public createDriver = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const input = createDriverSchema.parse(request.body);
      const driver = await this.driverService.createDriver(input);
      response.status(201).json({ data: driver });
    } catch (error: unknown) {
      next(error);
    }
  };

  public getDriver = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = driverIdParamsSchema.parse(request.params);
      const driver = await this.driverService.getDriver(id);
      response.status(200).json({ data: driver });
    } catch (error: unknown) {
      next(error);
    }
  };

  public updateStatus = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = driverIdParamsSchema.parse(request.params);
      const { status } = updateDriverStatusSchema.parse(request.body);
      const driver = await this.driverService.updateStatus(id, status);
      response.status(200).json({ data: driver });
    } catch (error: unknown) {
      next(error);
    }
  };

  public updateLocation = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = driverIdParamsSchema.parse(request.params);
      const input = updateDriverLocationSchema.parse(request.body);
      const location = await this.driverService.updateLocation(id, input);
      response.status(200).json({ data: location });
    } catch (error: unknown) {
      next(error);
    }
  };
}
