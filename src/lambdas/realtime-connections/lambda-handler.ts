import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const tableName = process.env.DYNAMODB_TABLE_NAME;
if (!tableName) throw new Error('DYNAMODB_TABLE_NAME is required');

const database = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const response = (statusCode: number, message?: string): APIGatewayProxyResultV2 => ({
  statusCode,
  body: message ? JSON.stringify({ message }) : undefined,
});

const connect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const ticket = event.queryStringParameters?.ticket;
  const connectionId = event.requestContext.connectionId;
  if (!ticket || !connectionId) return response(401, 'Realtime ticket required');

  const deleted = await database.send(
    new DeleteCommand({
      TableName: tableName,
      Key: { PK: `WS_TICKET#${ticket}`, SK: 'TICKET' },
      ReturnValues: 'ALL_OLD',
    }),
  );
  const identity = deleted.Attributes;
  const now = Math.floor(Date.now() / 1000);
  if (
    !identity ||
    typeof identity.subject !== 'string' ||
    typeof identity.username !== 'string' ||
    !Array.isArray(identity.roles) ||
    typeof identity.expiresAt !== 'number' ||
    identity.expiresAt < now
  ) {
    return response(401, 'Realtime ticket is invalid or expired');
  }

  await database.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        PK: 'WS_CONNECTIONS',
        SK: connectionId,
        connectionId,
        subject: identity.subject,
        username: identity.username,
        roles: identity.roles,
        connectedAt: new Date().toISOString(),
        // API Gateway WebSocket connections last at most two hours.
        expiresAt: now + 2 * 60 * 60,
      },
    }),
  );
  return response(200);
};

const disconnect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = event.requestContext.connectionId;
  if (connectionId) {
    await database.send(
      new DeleteCommand({
        TableName: tableName,
        Key: { PK: 'WS_CONNECTIONS', SK: connectionId },
      }),
    );
  }
  return response(200);
};

export const handler = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    switch (event.requestContext.routeKey) {
      case '$connect':
        return await connect(event);
      case '$disconnect':
        return await disconnect(event);
      default:
        return response(200);
    }
  } catch (error: unknown) {
    console.error('WebSocket connection handler failed', error);
    return response(500, 'Realtime service unavailable');
  }
};
