import { ApiGatewayManagementApiClient } from '@aws-sdk/client-apigatewaymanagementapi';

import type { AppConfig } from './app-config.js';

export const createWebSocketManagementClient = (
  config: AppConfig,
): ApiGatewayManagementApiClient | null =>
  config.realtime.managementEndpoint
    ? new ApiGatewayManagementApiClient({
        region: config.aws.region,
        endpoint: config.realtime.managementEndpoint,
      })
    : null;
