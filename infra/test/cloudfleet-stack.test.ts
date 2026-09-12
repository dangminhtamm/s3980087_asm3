import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';

import { CloudFleetStack } from '../lib/cloudfleet-stack.js';
import { createDeploymentConfig } from '../lib/deployment-config.js';

const synthesize = (stage: 'dev' | 'prod'): Template => {
  const app = new App();
  const deployment = createDeploymentConfig({
    projectName: 'cloudfleet-test',
    stage,
    corsAllowedOrigins: 'http://localhost:5173,https://ops.example.com',
  });
  return Template.fromStack(
    new CloudFleetStack(app, `CloudFleet${stage}`, {
      deployment,
      env: { account: '111111111111', region: 'ap-southeast-1' },
    }),
  );
};

const dev = synthesize('dev');
const prod = synthesize('prod');

describe('deployment configuration', () => {
  it('derives typed stage policy and normalized origins', () => {
    const config = createDeploymentConfig({
      projectName: ' fleet ',
      stage: 'prod',
      corsAllowedOrigins: 'https://ops.example.com, https://ops.example.com',
      routingProvider: 'osrm',
    });
    assert.equal(config.prefix, 'fleet-prod');
    assert.equal(config.isProduction, true);
    assert.deepEqual(config.corsAllowedOrigins, ['https://ops.example.com']);
    assert.equal(config.routing.provider, 'osrm');
  });

  it('rejects unknown stages and malformed origins', () => {
    assert.throws(() => createDeploymentConfig({ stage: 'production' }), /stage must be one of/);
    assert.throws(
      () => createDeploymentConfig({ corsAllowedOrigins: 'https://example.com/path' }),
      /Invalid CORS origin/,
    );
  });

  it('supports account-agnostic CI synthesis with a valid Cognito domain', () => {
    const app = new App();
    const stack = new CloudFleetStack(app, 'AccountAgnostic', {
      deployment: createDeploymentConfig({
        projectName: 'cloudfleet',
        stage: 'test',
      }),
    });
    const template = Template.fromStack(stack);
    const domains = template.findResources('AWS::Cognito::UserPoolDomain');
    const domain = Object.values(domains)[0]?.Properties?.Domain as string;

    assert.match(domain, /^[a-z0-9-]{1,63}$/);
    assert.equal(domain.includes('token'), false);
  });
});

describe('security-critical infrastructure', () => {
  it('preserves pre-modularization logical IDs for stateful and entrypoint resources', () => {
    const logicalIds = new Set(Object.keys(dev.toJSON().Resources));
    for (const logicalId of [
      'OperationalTable89D9F19C',
      'FrontendBucketEFE2E19C',
      'DeliveryProofBucketBBD3CB7E',
      'AnalyticsBucket39EAAEEA',
      'UserPool6BA7E5F2',
      'ApplicationSecret25AD4F13',
      'HttpApiF5A9A8A7',
    ]) {
      assert.ok(logicalIds.has(logicalId), `${logicalId} changed during construct extraction`);
    }
  });

  it('encrypts DynamoDB and every S3 bucket and blocks public S3 access', () => {
    dev.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: { SSEEnabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
    const buckets = dev.findResources('AWS::S3::Bucket');
    assert.equal(Object.keys(buckets).length, 3);
    for (const bucket of Object.values(buckets)) {
      assert.deepEqual(
        bucket.Properties?.BucketEncryption?.ServerSideEncryptionConfiguration?.[0]
          ?.ServerSideEncryptionByDefault,
        { SSEAlgorithm: 'AES256' },
      );
      assert.deepEqual(bucket.Properties?.PublicAccessBlockConfiguration, {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
  });

  it('retains operational state in prod and permits clean dev teardown', () => {
    const criticalTypes = [
      'AWS::DynamoDB::Table',
      'AWS::S3::Bucket',
      'AWS::Cognito::UserPool',
      'AWS::SecretsManager::Secret',
    ];
    for (const type of criticalTypes) {
      for (const resource of Object.values(dev.findResources(type))) {
        assert.equal(resource.DeletionPolicy, 'Delete', `${type} must be deletable in dev`);
      }
      for (const resource of Object.values(prod.findResources(type))) {
        assert.equal(resource.DeletionPolicy, 'Retain', `${type} must be retained in prod`);
        assert.equal(resource.UpdateReplacePolicy, 'Retain');
      }
    }
  });

  it('retains logs for seven days and lifecycle-manages durable bucket data', () => {
    const logGroups = dev.findResources('AWS::Logs::LogGroup');
    assert.ok(Object.keys(logGroups).length >= 3);
    for (const logGroup of Object.values(logGroups)) {
      assert.equal(logGroup.Properties?.RetentionInDays, 7);
    }
    dev.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ Id: 'ArchiveOldProofs', Status: 'Enabled' })]),
      },
    });
    dev.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Id: 'ExpireAnalyticsLogs', ExpirationInDays: 30 }),
          Match.objectLike({ Id: 'ExpireDynamoDbExports', ExpirationInDays: 7 }),
        ]),
      },
    });
  });

  it('requires Cognito JWT for private routes while keeping intended routes public', () => {
    for (const routeKey of ['ANY /api', 'ANY /api/{proxy+}']) {
      dev.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
        AuthorizationType: 'JWT',
        AuthorizerId: Match.anyValue(),
      });
    }
    for (const routeKey of [
      'GET /health',
      'GET /ready',
      'GET /api/tracking/{trackingToken}',
      'POST /api/tracking/{trackingToken}/feedback',
      'POST /api/tracking/{trackingToken}/reschedule',
      'POST /api/telemetry/frontend',
    ]) {
      dev.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: routeKey,
        AuthorizationType: 'NONE',
      });
    }
  });

  it('configures API and proof-upload CORS explicitly', () => {
    dev.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      CorsConfiguration: Match.objectLike({
        AllowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-ID'],
        AllowMethods: ['*'],
        AllowOrigins: Match.arrayWith(['http://localhost:5173', 'https://ops.example.com']),
        MaxAge: 600,
      }),
    });
    dev.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [
          Match.objectLike({
            AllowedMethods: ['PUT'],
            AllowedOrigins: Match.arrayWith(['http://localhost:5173', 'https://ops.example.com']),
          }),
        ],
      },
    });
  });

  it('uses container and load-balancer health checks', () => {
    dev.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          HealthCheck: Match.objectLike({
            Command: Match.arrayWith(['CMD-SHELL', Match.stringLikeRegexp('/health')]),
          }),
        }),
      ]),
    });
    dev.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/health',
      Matcher: { HttpCode: '200' },
    });
  });

  it('hosts the SPA behind CloudFront with private S3 origin access', () => {
    dev.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        Enabled: true,
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' }),
        ]),
      }),
    });
    dev.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    dev.hasOutput('FrontendDistributionId', {});
  });

  it('provisions real EMR Serverless and Step Functions analytics resources', () => {
    dev.hasResourceProperties('AWS::EMRServerless::Application', {
      Type: 'SPARK',
      ReleaseLabel: 'emr-7.13.0',
    });
    dev.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'STANDARD',
      TracingConfiguration: { Enabled: true },
    });
    dev.hasOutput('AnalyticsStateMachineArn', {});
  });
});
