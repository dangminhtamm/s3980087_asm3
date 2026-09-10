import {
  GoneException,
  PostToConnectionCommand,
  type ApiGatewayManagementApiClient,
} from '@aws-sdk/client-apigatewaymanagementapi';
import {
  DeleteCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type { DriverLocation } from '../domain/entities/driver.js';

interface ConnectionItem {
  connectionId: string;
  roles: string[];
}

export class RealtimeBroadcaster {
  public constructor(
    private readonly database: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly gateway: ApiGatewayManagementApiClient | null,
  ) {}

  public async publishDriverLocation(location: DriverLocation): Promise<void> {
    if (!this.gateway) return;

    try {
      const result = await this.database.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': 'WS_CONNECTIONS' },
          ProjectionExpression: 'connectionId, roles',
        }),
      );
      const connections = (result.Items ?? [])
        .filter(
          (item): item is ConnectionItem =>
            typeof item.connectionId === 'string' &&
            Array.isArray(item.roles) &&
            item.roles.includes('ADMIN'),
        );
      const payload = Buffer.from(
        JSON.stringify({ type: 'driver.location.updated', data: location }),
      );

      await Promise.allSettled(
        connections.map((connection) =>
          this.postOrRemoveStaleConnection(connection.connectionId, payload),
        ),
      );
    } catch (error: unknown) {
      // Location persistence is the source of truth. A transient WebSocket
      // failure must not make the driver's REST update fail.
      console.error('Unable to broadcast driver location', error);
    }
  }

  private async postOrRemoveStaleConnection(
    connectionId: string,
    payload: Uint8Array,
  ): Promise<void> {
    try {
      await this.gateway!.send(
        new PostToConnectionCommand({ ConnectionId: connectionId, Data: payload }),
      );
    } catch (error: unknown) {
      if (error instanceof GoneException || (error instanceof Error && error.name === 'GoneException')) {
        await this.database.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: { PK: 'WS_CONNECTIONS', SK: connectionId },
          }),
        );
        return;
      }
      throw error;
    }
  }
}
