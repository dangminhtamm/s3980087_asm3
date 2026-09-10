import 'dotenv/config';

import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';

const managementEndpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT?.trim();

export const WEBSOCKET_PUBLIC_URL =
  process.env.WEBSOCKET_PUBLIC_URL?.trim() || null;

/** Undefined locally: location writes still succeed, but broadcasting is off. */
export const webSocketManagementClient = managementEndpoint
  ? new ApiGatewayManagementApiClient({
      region: process.env.AWS_REGION?.trim() || 'ap-southeast-1',
      endpoint: managementEndpoint,
    })
  : null;
