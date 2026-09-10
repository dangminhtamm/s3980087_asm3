import type { NextFunction, Request, Response } from 'express';

import type { RealtimeTicketService } from '../services/realtime-ticket.service.js';

export class RealtimeController {
  public constructor(private readonly tickets: RealtimeTicketService) {}

  public createTicket = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const ticket = await this.tickets.issue(request.authenticatedUser!);
      response.status(201).json({ data: ticket });
    } catch (error: unknown) {
      next(error);
    }
  };
}
