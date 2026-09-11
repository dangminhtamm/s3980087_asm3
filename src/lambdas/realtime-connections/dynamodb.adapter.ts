import { DeleteCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { RealtimeConnectionPort, RealtimeIdentity } from './ports.js';

const toIdentity = (value: Record<string, unknown> | undefined): RealtimeIdentity | null => {
  if (
    !value ||
    typeof value.subject !== 'string' ||
    typeof value.username !== 'string' ||
    !Array.isArray(value.roles) ||
    !value.roles.every((role) => typeof role === 'string') ||
    typeof value.expiresAt !== 'number'
  ) {
    return null;
  }
  return {
    subject: value.subject,
    username: value.username,
    roles: value.roles as string[],
    expiresAt: value.expiresAt,
  };
};

export class DynamoRealtimeConnectionAdapter implements RealtimeConnectionPort {
  constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  async consumeTicket(ticket: string): Promise<RealtimeIdentity | null> {
    const result = await this.database.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: `WS_TICKET#${ticket}`, SK: 'TICKET' },
        ReturnValues: 'ALL_OLD',
      }),
    );
    return toIdentity(result.Attributes);
  }

  async saveConnection(
    connectionId: string,
    identity: RealtimeIdentity,
    expiresAt: number,
  ): Promise<void> {
    await this.database.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: 'WS_CONNECTIONS',
          SK: connectionId,
          connectionId,
          subject: identity.subject,
          username: identity.username,
          roles: identity.roles,
          connectedAt: this.nowIso(),
          expiresAt,
        },
      }),
    );
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.database.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: 'WS_CONNECTIONS', SK: connectionId },
      }),
    );
  }
}
