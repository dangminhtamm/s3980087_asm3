import path from 'node:path';

import { Duration, Stack } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';

import { projectRoot } from '../project-paths.js';

export interface FrontendHostingProps {
  prefix: string;
  frontendBucket: s3.Bucket;
}

export class FrontendHosting extends Construct {
  public readonly distribution: cloudfront.Distribution;
  public readonly publicUrl: string;
  private readonly prefix: string;
  private readonly frontendBucket: s3.Bucket;

  public constructor(scope: Construct, id: string, props: FrontendHostingProps) {
    super(scope, id);
    this.prefix = props.prefix;
    this.frontendBucket = props.frontendBucket;
    const origin = origins.S3BucketOrigin.withOriginAccessControl(props.frontendBucket);
    const behavior: cloudfront.BehaviorOptions = {
      origin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };
    this.distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      comment: `${props.prefix} React frontend`,
      defaultRootObject: 'index.html',
      defaultBehavior: behavior,
      additionalBehaviors: {
        'runtime-config.js': { ...behavior, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED },
        'sw.js': { ...behavior, cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED },
      },
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      })),
      enableIpv6: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });
    this.publicUrl = `https://${this.distribution.distributionDomainName}`;
  }

  public deploy(input: {
    httpApi: apigwv2.HttpApi;
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    userPoolDomain: cognito.UserPoolDomain;
    labRole: iam.IRole;
  }): void {
    const deployment = new s3deploy.BucketDeployment(this, 'FrontendDeployment', {
      destinationBucket: this.frontendBucket,
      sources: [s3deploy.Source.asset(path.join(projectRoot, 'frontend/dist'))],
      exclude: ['runtime-config.js'],
      prune: true,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      role: input.labRole,
    });
    const runtimeConfiguration = Stack.of(this).toJsonString({
      VITE_API_BASE_URL: input.httpApi.apiEndpoint,
      VITE_AUTH_MODE: 'cognito',
      VITE_COGNITO_REGION: Stack.of(this).region,
      VITE_COGNITO_USER_POOL_ID: input.userPool.userPoolId,
      VITE_COGNITO_CLIENT_ID: input.userPoolClient.userPoolClientId,
      VITE_COGNITO_DOMAIN: input.userPoolDomain.baseUrl(),
      VITE_COGNITO_REDIRECT_URI: `${this.publicUrl}/auth/callback`,
      VITE_ENABLE_MOCK_FALLBACK: 'false',
    });
    const request: customResources.AwsSdkCall = {
      service: 'S3',
      action: 'putObject',
      parameters: {
        Bucket: this.frontendBucket.bucketName,
        Key: 'runtime-config.js',
        Body: `window.__CLOUDFLEET_CONFIG__ = ${runtimeConfiguration};\n`,
        ContentType: 'application/javascript; charset=utf-8',
        CacheControl: 'no-store, max-age=0',
      },
      physicalResourceId: customResources.PhysicalResourceId.of(
        `${this.prefix}-frontend-runtime-config`,
      ),
    };
    const writer = new customResources.AwsCustomResource(this, 'FrontendRuntimeConfig', {
      onCreate: request,
      onUpdate: request,
      onDelete: {
        service: 'S3',
        action: 'deleteObject',
        parameters: { Bucket: this.frontendBucket.bucketName, Key: 'runtime-config.js' },
      },
      role: input.labRole,
      installLatestAwsSdk: false,
    });
    writer.node.addDependency(deployment);
  }
}
