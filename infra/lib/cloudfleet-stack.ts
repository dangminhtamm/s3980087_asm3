import { createHash } from 'node:crypto';

import { CfnOutput, Stack, Tags, type CfnElement, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

import { AnalyticsPipeline } from './constructs/analytics-pipeline.js';
import { ApiCompute } from './constructs/api-compute.js';
import { FrontendHosting } from './constructs/frontend-hosting.js';
import { Identity } from './constructs/identity.js';
import { Observability } from './constructs/observability.js';
import { OperationalData } from './constructs/operational-data.js';
import { Realtime } from './constructs/realtime.js';
import { Storage } from './constructs/storage.js';
import type { DeploymentConfig } from './deployment-config.js';

export interface CloudFleetStackProps extends StackProps {
  deployment: DeploymentConfig;
}

const constructBoundaries = new Set([
  'OperationalData',
  'Storage',
  'Identity',
  'FrontendHosting',
  'ApiCompute',
  'Realtime',
  'AnalyticsPipeline',
  'Observability',
]);

const stableLogicalId = (components: string[]): string => {
  const filtered = components.filter((component) => component !== 'Default');
  if (filtered.length === 1) return filtered[0]!.replaceAll(/[^A-Za-z0-9]/g, '');
  const deduplicated = filtered.filter(
    (component, index) => index === 0 || !filtered[index - 1]!.endsWith(component),
  );
  const human = deduplicated
    .filter((component) => component !== 'Resource')
    .map((component) => component.replaceAll(/[^A-Za-z0-9]/g, ''))
    .join('')
    .slice(0, 240);
  const hash = createHash('md5').update(filtered.join('/')).digest('hex').slice(0, 8).toUpperCase();
  return `${human}${hash}`;
};

export class CloudFleetStack extends Stack {
  public constructor(scope: Construct, id: string, props: CloudFleetStackProps) {
    super(scope, id, props);
    const config = props.deployment;
    const labRole = iam.Role.fromRoleArn(
      this,
      'LabRole',
      `arn:aws:iam::${this.account}:role/LabRole`,
      { mutable: false },
    );
    Tags.of(this).add('Project', config.projectName);
    Tags.of(this).add('Stage', config.stage);
    Tags.of(this).add('ManagedBy', 'AWS-CDK');

    const operationalData = new OperationalData(this, 'OperationalData', config);
    const storage = new Storage(this, 'Storage', { ...config, account: this.account });
    const frontend = new FrontendHosting(this, 'FrontendHosting', {
      prefix: config.prefix,
      frontendBucket: storage.frontendBucket,
    });
    const allowedOrigins = [...config.corsAllowedOrigins, frontend.publicUrl];
    storage.deliveryProofBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.PUT],
      allowedOrigins,
      allowedHeaders: ['Content-Type', 'x-amz-meta-orderid'],
      exposedHeaders: ['ETag'],
      maxAge: 3_600,
    });
    const identity = new Identity(this, 'Identity', {
      ...config,
      account: this.account,
      allowedOrigins,
    });
    const realtime = new Realtime(this, 'Realtime', {
      prefix: config.prefix,
      stage: config.stage,
      table: operationalData.table,
      labRole,
    });
    const analytics = new AnalyticsPipeline(this, 'AnalyticsPipeline', {
      prefix: config.prefix,
      table: operationalData.table,
      analyticsBucket: storage.analyticsBucket,
      labRole,
    });
    const api = new ApiCompute(this, 'ApiCompute', {
      prefix: config.prefix,
      table: operationalData.table,
      deliveryProofBucket: storage.deliveryProofBucket,
      analyticsBucket: storage.analyticsBucket,
      analyticsStateMachine: analytics.stateMachine,
      realtimeApi: realtime.api,
      webSocketPublicUrl: realtime.publicUrl,
      webSocketManagementEndpoint: realtime.managementEndpoint,
      trackingBaseUrl: frontend.publicUrl,
      corsAllowedOrigins: allowedOrigins,
      userPool: identity.userPool,
      userPoolClient: identity.userPoolClient,
      applicationSecret: identity.applicationSecret,
      labRole,
      routing: config.routing,
    });
    operationalData.addNotificationWorker({
      prefix: config.prefix,
      applicationSecret: identity.applicationSecret,
      labRole,
      trackingBaseUrl: frontend.publicUrl,
    });
    frontend.deploy({
      httpApi: api.httpApi,
      userPool: identity.userPool,
      userPoolClient: identity.userPoolClient,
      userPoolDomain: identity.userPoolDomain,
      labRole,
    });
    const observability = new Observability(this, 'Observability', { prefix: config.prefix });
    this.addOutputs({
      operationalData,
      storage,
      frontend,
      identity,
      realtime,
      analytics,
      api,
      observability,
    });
  }

  /** Keeps pre-modularization CloudFormation logical IDs stable during construct moves. */
  protected override allocateLogicalId(element: CfnElement): string {
    const scopes = element.node.scopes;
    const stackIndex = scopes.indexOf(this);
    const components = scopes
      .slice(stackIndex + 1)
      .map((scope) => scope.node.id)
      .filter((component) => !constructBoundaries.has(component));
    return stableLogicalId(components);
  }

  private addOutputs(input: {
    operationalData: OperationalData;
    storage: Storage;
    frontend: FrontendHosting;
    identity: Identity;
    realtime: Realtime;
    analytics: AnalyticsPipeline;
    api: ApiCompute;
    observability: Observability;
  }): void {
    const output = (id: string, value: string, description?: string) =>
      new CfnOutput(this, id, { value, description });
    output('ApiUrl', input.api.httpApi.apiEndpoint);
    output('FrontendBucketName', input.storage.frontendBucket.bucketName);
    output(
      'FrontendUrl',
      input.frontend.publicUrl,
      'CloudFront HTTPS URL for the CloudFleet React application.',
    );
    output('FrontendDistributionId', input.frontend.distribution.distributionId);
    output('DeliveryProofBucketName', input.storage.deliveryProofBucket.bucketName);
    output('AnalyticsBucketName', input.storage.analyticsBucket.bucketName);
    output('WebSocketUrl', input.realtime.publicUrl);
    output('EmrServerlessApplicationId', input.analytics.application.attrApplicationId);
    output('EmrAnalyticsJobRoleArn', input.analytics.jobRole.roleArn);
    output('EmrAnalyticsEntryPoint', input.analytics.entryPoint);
    output('AnalyticsStateMachineArn', input.analytics.stateMachine.stateMachineArn);
    output('OrdersTableName', input.operationalData.table.tableName);
    output('CognitoUserPoolId', input.identity.userPool.userPoolId);
    output('CognitoUserPoolClientId', input.identity.userPoolClient.userPoolClientId);
    output('CognitoHostedUiUrl', input.identity.userPoolDomain.baseUrl());
    output(
      'ApplicationSecretArn',
      input.identity.applicationSecret.secretArn,
      'Update the placeholder Twilio and VAPID values after deployment.',
    );
    output('ObservabilityDashboardName', input.observability.dashboard.dashboardName);
  }
}
