import path from 'node:path';

import { Duration, Stack } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

import { projectRoot } from '../project-paths.js';

export interface RealtimeProps {
  prefix: string;
  stage: string;
  table: dynamodb.Table;
  labRole: iam.IRole;
}

export class Realtime extends Construct {
  public readonly api: apigwv2.WebSocketApi;
  public readonly publicUrl: string;
  public readonly managementEndpoint: string;

  public constructor(scope: Construct, id: string, props: RealtimeProps) {
    super(scope, id);
    const handler = new lambdaNodejs.NodejsFunction(this, 'RealtimeConnectionsFunction', {
      functionName: `${props.prefix}-realtime-connections`,
      description: 'Consumes one-time tickets and tracks WebSocket connections.',
      entry: path.join(projectRoot, 'src/lambdas/realtime-connections/lambda-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      role: props.labRole,
      projectRoot,
      environment: { DYNAMODB_TABLE_NAME: props.table.tableName },
      bundling: { minify: true, sourceMap: true, target: 'node22' },
    });
    props.table.grantReadWriteData(handler);
    const integration = (id: string) => new WebSocketLambdaIntegration(id, handler);
    this.api = new apigwv2.WebSocketApi(this, 'RealtimeWebSocketApi', {
      apiName: `${props.prefix}-realtime`,
      routeSelectionExpression: '$request.body.action',
      connectRouteOptions: { integration: integration('RealtimeConnectIntegration') },
      disconnectRouteOptions: { integration: integration('RealtimeDisconnectIntegration') },
      defaultRouteOptions: { integration: integration('RealtimeDefaultIntegration') },
    });
    new apigwv2.WebSocketStage(this, 'RealtimeWebSocketStage', {
      webSocketApi: this.api,
      stageName: props.stage,
      autoDeploy: true,
    });
    const stack = Stack.of(this);
    const host = `${this.api.apiId}.execute-api.${stack.region}.${stack.urlSuffix}`;
    this.publicUrl = `wss://${host}/${props.stage}`;
    this.managementEndpoint = `https://${host}/${props.stage}`;
  }
}
