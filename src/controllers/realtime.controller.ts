import type { Request, Response } from 'express';

import { sendData } from '../http/response.js';
import type { RealtimeTicketService } from '../services/realtime-ticket.service.js';

export class RealtimeController {
  public constructor(private readonly tickets: RealtimeTicketService) {}

  public createTicket = async (request: Request, response: Response): Promise<void> => {
    sendData(response, 201, await this.tickets.issue(request.authenticatedUser!));
  };
}
