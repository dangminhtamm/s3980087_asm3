import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoRealtimeConnectionAdapter } from './dynamodb.adapter.js';
import { RealtimeConnectionsService } from './realtime-connections.service.js';

const tableName = process.env.DYNAMODB_TABLE_NAME?.trim();
if (!tableName) throw new Error('DYNAMODB_TABLE_NAME is required');
const database = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const service = new RealtimeConnectionsService(
  new DynamoRealtimeConnectionAdapter(database, tableName),
);
const response = (statusCode: number, message?: string): APIGatewayProxyResultV2 => ({
  statusCode,
  body: message ? JSON.stringify({ message }) : undefined,
});

export const handler = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const connectionId = event.requestContext.connectionId;
    if (event.requestContext.routeKey === '$connect') {
      const ticket = event.queryStringParameters?.ticket;
      if (!ticket || !connectionId) return response(401, 'Realtime ticket required');
      const accepted = await service.connect(ticket, connectionId);
      return accepted ? response(200) : response(401, 'Realtime ticket is invalid or expired');
    }
    if (event.requestContext.routeKey === '$disconnect') await service.disconnect(connectionId);
    return response(200);
  } catch (error: unknown) {
    console.error('WebSocket connection handler failed', error);
    return response(500, 'Realtime service unavailable');
  }
};
