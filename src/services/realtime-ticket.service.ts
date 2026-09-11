import { randomUUID } from 'node:crypto';

import { PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { AuthenticatedUser } from '../domain/entities/auth.js';
import { AppError } from '../errors/app-error.js';

const TICKET_LIFETIME_SECONDS = 60;

export interface RealtimeTicket {
  ticket: string;
  webSocketUrl: string;
  expiresAt: string;
}

export class RealtimeTicketService {
  public constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly publicWebSocketUrl: string | null,
  ) {}

  public async issue(user: AuthenticatedUser): Promise<RealtimeTicket> {
    if (!this.publicWebSocketUrl) {
      throw new AppError(503, 'Realtime WebSocket is not configured', 'REALTIME_NOT_CONFIGURED');
    }

    const ticket = randomUUID();
    const expiresAtEpoch = Math.floor(Date.now() / 1000) + TICKET_LIFETIME_SECONDS;
    await this.database.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `WS_TICKET#${ticket}`,
          SK: 'TICKET',
          subject: user.subject,
          username: user.username,
          roles: user.roles,
          expiresAt: expiresAtEpoch,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );

    return {
      ticket,
      webSocketUrl: this.publicWebSocketUrl,
      expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
    };
  }
}
