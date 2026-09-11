import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
} from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import {
  HttpAlbIntegration,
  WebSocketLambdaIntegration,
} from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as customResources from 'aws-cdk-lib/custom-resources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as emrserverless from 'aws-cdk-lib/aws-emrserverless';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import type { Construct } from 'constructs';

export interface CloudFleetStackProps extends StackProps {
  projectName: string;
  stage: string;
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '../..');

export class CloudFleetStack extends Stack {
  public constructor(
    scope: Construct,
    id: string,
    props: CloudFleetStackProps,
  ) {
    super(scope, id, props);

    const { projectName, stage } = props;
    const prefix = `${projectName}-${stage}`;
    const isProduction = stage === 'prod';
    const removalPolicy = isProduction
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;
    const localCorsAllowedOrigins = this.parseCorsOrigins();
    // AWS Academy/VocLabs supplies this role and prevents students from
    // creating project-specific IAM roles. Keep it immutable so CDK never
    // tries to attach inline policies to the managed LabRole.
    const labRole = iam.Role.fromRoleArn(
      this,
      'LabRole',
      `arn:aws:iam::${this.account}:role/LabRole`,
      { mutable: false },
    );

    Tags.of(this).add('Project', projectName);
    Tags.of(this).add('Stage', stage);
    Tags.of(this).add('ManagedBy', 'AWS-CDK');

    const table = this.createOperationalTable(prefix, removalPolicy);
    const { frontendBucket, deliveryProofBucket, analyticsBucket } = this.createStorage(
      prefix,
      removalPolicy,
      isProduction,
    );
    const frontendDistribution = this.createFrontendDistribution(
      prefix,
      frontendBucket,
    );
    const frontendUrl = `https://${frontendDistribution.distributionDomainName}`;
    const corsAllowedOrigins = [...localCorsAllowedOrigins, frontendUrl];

    // Drivers upload proof images directly from both local Vite and CloudFront.
    deliveryProofBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.PUT],
      allowedOrigins: corsAllowedOrigins,
      allowedHeaders: ['Content-Type', 'x-amz-meta-orderid'],
      exposedHeaders: ['ETag'],
      maxAge: 3_600,
    });
    const { userPool, userPoolClient, userPoolDomain } = this.createIdentity(
      prefix,
      removalPolicy,
      corsAllowedOrigins,
    );
    const applicationSecret = this.createApplicationSecret(prefix, removalPolicy);
    const notificationFunction = this.createNotificationFunction(
      prefix,
      table,
      applicationSecret,
      labRole,
      frontendUrl,
    );
    const realtime = this.createRealtimeApi(prefix, stage, table, labRole);
    const analytics = this.createAnalyticsResources(
      prefix,
      table,
      analyticsBucket,
      labRole,
    );
    const { listener, vpc, vpcLinkSecurityGroup } = this.createContainerService({
      prefix,
      table,
      deliveryProofBucket,
      corsAllowedOrigins,
      userPool,
      userPoolClient,
      analyticsBucket,
      analyticsStateMachine: analytics.stateMachine,
      realtimeApi: realtime.api,
      webSocketPublicUrl: realtime.publicUrl,
      webSocketManagementEndpoint: realtime.managementEndpoint,
      trackingBaseUrl: frontendUrl,
      applicationSecret,
      labRole,
    });
    const httpApi = this.createHttpApi({
      prefix,
      listener,
      vpc,
      vpcLinkSecurityGroup,
      userPool,
      userPoolClient,
      corsAllowedOrigins,
    });
    this.deployFrontend({
      prefix,
      frontendBucket,
      frontendDistribution,
      frontendUrl,
      httpApi,
      userPool,
      userPoolClient,
      userPoolDomain,
      labRole,
    });
    const observabilityDashboard = this.createObservabilityDashboard(prefix);

    // Explicit dependency documents the event flow even though the event source
    // construct already links the Lambda function and DynamoDB stream.
    notificationFunction.node.addDependency(table);

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'FrontendBucketName', {
      value: frontendBucket.bucketName,
    });
    new CfnOutput(this, 'FrontendUrl', {
      value: frontendUrl,
      description: 'CloudFront HTTPS URL for the CloudFleet React application.',
    });
    new CfnOutput(this, 'FrontendDistributionId', {
      value: frontendDistribution.distributionId,
    });
    new CfnOutput(this, 'DeliveryProofBucketName', {
      value: deliveryProofBucket.bucketName,
    });
    new CfnOutput(this, 'AnalyticsBucketName', {
      value: analyticsBucket.bucketName,
    });
    new CfnOutput(this, 'WebSocketUrl', { value: realtime.publicUrl });
    new CfnOutput(this, 'EmrServerlessApplicationId', {
      value: analytics.application.attrApplicationId,
    });
    new CfnOutput(this, 'EmrAnalyticsJobRoleArn', {
      value: analytics.jobRole.roleArn,
    });
    new CfnOutput(this, 'EmrAnalyticsEntryPoint', {
      value: analytics.entryPoint,
    });
    new CfnOutput(this, 'AnalyticsStateMachineArn', {
      value: analytics.stateMachine.stateMachineArn,
    });
    new CfnOutput(this, 'OrdersTableName', { value: table.tableName });
    new CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
    });
    new CfnOutput(this, 'CognitoUserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, 'CognitoHostedUiUrl', {
      value: userPoolDomain.baseUrl(),
    });
    new CfnOutput(this, 'ApplicationSecretArn', {
      value: applicationSecret.secretArn,
      description: 'Update the placeholder Twilio and VAPID values after deployment.',
    });
    new CfnOutput(this, 'ObservabilityDashboardName', {
      value: observabilityDashboard.dashboardName,
    });
  }

  private createOperationalTable(
    prefix: string,
    removalPolicy: RemovalPolicy,
  ): dynamodb.Table {
    const table = new dynamodb.Table(this, 'OperationalTable', {
      tableName: `${prefix}-operations`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    return table;
  }

  private createStorage(
    prefix: string,
    removalPolicy: RemovalPolicy,
    isProduction: boolean,
  ): {
    frontendBucket: s3.Bucket;
    deliveryProofBucket: s3.Bucket;
    analyticsBucket: s3.Bucket;
  } {
    const sharedProperties = {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy,
      // autoDeleteObjects creates an implicit custom-resource IAM role. Keep
      // it disabled for VocLabs; non-empty buckets must be emptied manually
      // before destroying a development stack.
      autoDeleteObjects: false,
    } as const;

    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      ...sharedProperties,
      bucketName: `${prefix}-frontend-${this.account}`,
      versioned: isProduction,
    });

    const deliveryProofBucket = new s3.Bucket(this, 'DeliveryProofBucket', {
      ...sharedProperties,
      bucketName: `${prefix}-delivery-proofs-${this.account}`,
      versioned: true,
      lifecycleRules: [
        {
          id: 'ArchiveOldProofs',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(90),
            },
          ],
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
    });

    const analyticsBucket = new s3.Bucket(this, 'AnalyticsBucket', {
      ...sharedProperties,
      bucketName: `${prefix}-analytics-${this.account}`,
      versioned: true,
      lifecycleRules: [
        {
          id: 'ExpireAnalyticsLogs',
          enabled: true,
          prefix: 'logs/',
          expiration: Duration.days(30),
        },
        {
          id: 'ExpireDynamoDbExports',
          enabled: true,
          prefix: 'dynamodb-exports/',
          expiration: Duration.days(7),
        },
      ],
    });

    return { frontendBucket, deliveryProofBucket, analyticsBucket };
  }

  private createFrontendDistribution(
    prefix: string,
    frontendBucket: s3.Bucket,
  ): cloudfront.Distribution {
    const origin = origins.S3BucketOrigin.withOriginAccessControl(frontendBucket);
    const behavior: cloudfront.BehaviorOptions = {
      origin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      compress: true,
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    };

    return new cloudfront.Distribution(this, 'FrontendDistribution', {
      comment: `${prefix} React frontend`,
      defaultRootObject: 'index.html',
      defaultBehavior: behavior,
      additionalBehaviors: {
        'runtime-config.js': {
          ...behavior,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
        'sw.js': {
          ...behavior,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
      // React Router routes do not exist as physical S3 objects. Return the app
      // shell so the browser router can resolve /admin, /driver, and callbacks.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      })),
      enableIpv6: true,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // Price Class 200 includes CloudFront edge locations in Vietnam/SEA.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });
  }

  private deployFrontend(input: {
    prefix: string;
    frontendBucket: s3.Bucket;
    frontendDistribution: cloudfront.Distribution;
    frontendUrl: string;
    httpApi: apigwv2.HttpApi;
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    userPoolDomain: cognito.UserPoolDomain;
    labRole: iam.IRole;
  }): void {
    const {
      prefix,
      frontendBucket,
      frontendDistribution,
      frontendUrl,
      httpApi,
      userPool,
      userPoolClient,
      userPoolDomain,
      labRole,
    } = input;
    const frontendDist = path.join(projectRoot, 'frontend/dist');
    const deployment = new s3deploy.BucketDeployment(
      this,
      'FrontendDeployment',
      {
        destinationBucket: frontendBucket,
        sources: [s3deploy.Source.asset(frontendDist)],
        // The local placeholder must never overwrite deployment-time settings.
        exclude: ['runtime-config.js'],
        prune: true,
        distribution: frontendDistribution,
        distributionPaths: ['/*'],
        role: labRole,
      },
    );

    const runtimeConfiguration = this.toJsonString({
      VITE_API_BASE_URL: httpApi.apiEndpoint,
      VITE_AUTH_MODE: 'cognito',
      VITE_COGNITO_REGION: this.region,
      VITE_COGNITO_USER_POOL_ID: userPool.userPoolId,
      VITE_COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      VITE_COGNITO_DOMAIN: userPoolDomain.baseUrl(),
      VITE_COGNITO_REDIRECT_URI: `${frontendUrl}/auth/callback`,
      VITE_ENABLE_MOCK_FALLBACK: 'false',
    });
    const runtimeObjectKey = 'runtime-config.js';
    const putRuntimeConfiguration: customResources.AwsSdkCall = {
      service: 'S3',
      action: 'putObject',
      parameters: {
        Bucket: frontendBucket.bucketName,
        Key: runtimeObjectKey,
        Body: `window.__CLOUDFLEET_CONFIG__ = ${runtimeConfiguration};\n`,
        ContentType: 'application/javascript; charset=utf-8',
        CacheControl: 'no-store, max-age=0',
      },
      physicalResourceId: customResources.PhysicalResourceId.of(
        `${prefix}-frontend-runtime-config`,
      ),
    };
    const runtimeConfigWriter = new customResources.AwsCustomResource(
      this,
      'FrontendRuntimeConfig',
      {
        onCreate: putRuntimeConfiguration,
        onUpdate: putRuntimeConfiguration,
        onDelete: {
          service: 'S3',
          action: 'deleteObject',
          parameters: {
            Bucket: frontendBucket.bucketName,
            Key: runtimeObjectKey,
          },
        },
        role: labRole,
        installLatestAwsSdk: false,
      },
    );

    // BucketDeployment excludes this object from both sync and prune. Writing it
    // last guarantees that the first viewer receives production configuration.
    runtimeConfigWriter.node.addDependency(deployment);
  }

  private createIdentity(
    prefix: string,
    removalPolicy: RemovalPolicy,
    corsAllowedOrigins: string[],
  ): {
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    userPoolDomain: cognito.UserPoolDomain;
  } {
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-users`,
      selfSignUpEnabled: false,
      // Keep driverId as the immutable Cognito username while allowing email
      // as a convenient sign-in alias (for example username DRV-018).
      signInAliases: { username: true, email: true },
      signInCaseSensitive: false,
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      removalPolicy,
    });

    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'ADMIN',
      description: 'CloudFleet administrators and dispatchers',
      precedence: 1,
    });
    new cognito.CfnUserPoolGroup(this, 'DriverGroup', {
      userPoolId: userPool.userPoolId,
      groupName: 'DRIVER',
      description: 'CloudFleet delivery drivers',
      precedence: 2,
    });

    const callbackUrls = corsAllowedOrigins.map(
      (origin) => `${origin}/auth/callback`,
    );
    const logoutUrls = corsAllowedOrigins.map((origin) => `${origin}/`);
    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: `${prefix}-web`,
      generateSecret: false,
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls,
        logoutUrls,
      },
    });
    const userPoolDomain = userPool.addDomain('HostedDomain', {
      cognitoDomain: {
        domainPrefix: `${prefix}-${this.account}`.toLowerCase(),
      },
    });

    return { userPool, userPoolClient, userPoolDomain };
  }

  private createApplicationSecret(
    prefix: string,
    removalPolicy: RemovalPolicy,
  ): secretsmanager.Secret {
    return new secretsmanager.Secret(this, 'ApplicationSecret', {
      secretName: `${prefix}/application-secrets`,
      description: 'CloudFleet provider credentials. Replace placeholder values after deploy.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          twilioAccountSid: 'REPLACE_ME',
          twilioAuthToken: 'REPLACE_ME',
          twilioFromNumber: '+10000000000',
          vapidPublicKey: 'REPLACE_ME',
          vapidPrivateKey: 'REPLACE_ME',
          vapidSubject: 'mailto:ops@cloudfleet.example',
        }),
        generateStringKey: 'deploymentNonce',
        excludePunctuation: true,
      },
      removalPolicy,
    });
  }

  private createNotificationFunction(
    prefix: string,
    table: dynamodb.Table,
    applicationSecret: secretsmanager.Secret,
    labRole: iam.IRole,
    trackingBaseUrl: string,
  ): lambdaNodejs.NodejsFunction {
    const functionName = `${prefix}-delivery-notification`;
    const functionLogGroup = new logs.LogGroup(
      this,
      'DeliveryNotificationLogGroup',
      {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );
    const notificationFunction = new lambdaNodejs.NodejsFunction(
      this,
      'DeliveryNotificationFunction',
      {
        functionName,
        description: 'Sends secure customer tracking links on delivery status changes.',
        entry: path.join(
          projectRoot,
          'src/lambdas/delivery-notification/lambda-handler.ts',
        ),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(15),
        logGroup: functionLogGroup,
        role: labRole,
        projectRoot,
        environment: {
          APP_SECRET_ARN: applicationSecret.secretArn,
          DYNAMODB_TABLE_NAME: table.tableName,
          TRACKING_BASE_URL: trackingBaseUrl,
          OBSERVABILITY_ENVIRONMENT: prefix,
          METRICS_SERVICE_NAME: 'cloudfleet-notification',
        },
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node22',
        },
      },
    );

    applicationSecret.grantRead(notificationFunction);
    table.grantReadWriteData(notificationFunction);
    notificationFunction.addEventSource(
      new lambdaEventSources.DynamoEventSource(table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(2),
        bisectBatchOnError: true,
        retryAttempts: 3,
        reportBatchItemFailures: true,
      }),
    );

    return notificationFunction;
  }

  private createRealtimeApi(
    prefix: string,
    stageName: string,
    table: dynamodb.Table,
    labRole: iam.IRole,
  ): {
    api: apigwv2.WebSocketApi;
    publicUrl: string;
    managementEndpoint: string;
  } {
    const handler = new lambdaNodejs.NodejsFunction(
      this,
      'RealtimeConnectionsFunction',
      {
        functionName: `${prefix}-realtime-connections`,
        description: 'Consumes one-time tickets and tracks WebSocket connections.',
        entry: path.join(
          projectRoot,
          'src/lambdas/realtime-connections/lambda-handler.ts',
        ),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(10),
        role: labRole,
        projectRoot,
        environment: { DYNAMODB_TABLE_NAME: table.tableName },
        bundling: { minify: true, sourceMap: true, target: 'node22' },
      },
    );
    table.grantReadWriteData(handler);

    const api = new apigwv2.WebSocketApi(this, 'RealtimeWebSocketApi', {
      apiName: `${prefix}-realtime`,
      routeSelectionExpression: '$request.body.action',
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          'RealtimeConnectIntegration',
          handler,
        ),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          'RealtimeDisconnectIntegration',
          handler,
        ),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          'RealtimeDefaultIntegration',
          handler,
        ),
      },
    });
    new apigwv2.WebSocketStage(this, 'RealtimeWebSocketStage', {
      webSocketApi: api,
      stageName,
      autoDeploy: true,
    });

    const host = `${api.apiId}.execute-api.${this.region}.${this.urlSuffix}`;
    return {
      api,
      publicUrl: `wss://${host}/${stageName}`,
      managementEndpoint: `https://${host}/${stageName}`,
    };
  }

  private createAnalyticsResources(
    prefix: string,
    table: dynamodb.Table,
    analyticsBucket: s3.Bucket,
    labRole: iam.IRole,
  ): {
    application: emrserverless.CfnApplication;
    jobRole: iam.IRole;
    entryPoint: string;
    stateMachine: sfn.StateMachine;
  } {
    new s3deploy.BucketDeployment(this, 'AnalyticsJobDeployment', {
      destinationBucket: analyticsBucket,
      destinationKeyPrefix: 'emr/jobs',
      sources: [
        s3deploy.Source.asset(path.join(projectRoot, 'analytics/emr/jobs')),
      ],
      prune: false,
      role: labRole,
    });

    // This project runs EMR Serverless, which accepts a per-job runtime role
    // instead of the EMR cluster service role / EC2 instance profile pair.
    const jobRole = labRole;

    const application = new emrserverless.CfnApplication(
      this,
      'AnalyticsApplication',
      {
        name: `${prefix}-delivery-analytics`,
        type: 'SPARK',
        releaseLabel: 'emr-7.13.0',
        autoStartConfiguration: { enabled: true },
        autoStopConfiguration: { enabled: true, idleTimeoutMinutes: 15 },
      },
    );
    const entryPoint = `s3://${analyticsBucket.bucketName}/emr/jobs/delivery_performance.py`;

    const workflowFunctionName = `${prefix}-analytics-workflow`;
    const workflowFunctionLogGroup = new logs.LogGroup(
      this,
      'AnalyticsWorkflowFunctionLogGroup',
      {
        logGroupName: `/aws/lambda/${workflowFunctionName}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );
    const workflowFunction = new lambdaNodejs.NodejsFunction(
      this,
      'AnalyticsWorkflowFunction',
      {
        functionName: workflowFunctionName,
        description: 'Exports DynamoDB and controls the CloudFleet EMR analytics job.',
        entry: path.join(
          projectRoot,
          'src/lambdas/analytics-workflow/lambda-handler.ts',
        ),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(30),
        logGroup: workflowFunctionLogGroup,
        role: labRole,
        projectRoot,
        environment: {
          TABLE_ARN: table.tableArn,
          ANALYTICS_BUCKET: analyticsBucket.bucketName,
          EMR_APPLICATION_ID: application.attrApplicationId,
          EMR_JOB_ROLE_ARN: jobRole.roleArn,
          EMR_ENTRY_POINT: entryPoint,
        },
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node22',
        },
      },
    );

    // LabRole is immutable in this stack. Its preconfigured policy must allow
    // DynamoDB export, S3 analytics access, EMR Serverless job control, and
    // iam:PassRole for LabRole itself.

    const invoke = (
      id: string,
      action: string,
      fields: Record<string, string>,
    ): sfnTasks.LambdaInvoke => {
      const task = new sfnTasks.LambdaInvoke(this, id, {
        lambdaFunction: workflowFunction,
        payloadResponseOnly: true,
        payload: sfn.TaskInput.fromObject({ action, ...fields }),
      });
      return task;
    };

    const startExport = invoke('StartDynamoDbExport', 'START_EXPORT', {
      runId: sfn.JsonPath.stringAt('$.runId'),
    });
    const waitForExport = new sfn.Wait(this, 'WaitForDynamoDbExport', {
      time: sfn.WaitTime.duration(Duration.seconds(20)),
    });
    const checkExport = invoke('CheckDynamoDbExport', 'CHECK_EXPORT', {
      runId: sfn.JsonPath.stringAt('$.runId'),
      exportArn: sfn.JsonPath.stringAt('$.exportArn'),
    });
    const exportFailed = new sfn.Fail(this, 'DynamoDbExportFailed', {
      error: 'DynamoDbExportFailed',
      cause: 'DynamoDB point-in-time export failed.',
    });

    const startJob = invoke('StartEmrServerlessJob', 'START_JOB', {
      runId: sfn.JsonPath.stringAt('$.runId'),
      inputUri: sfn.JsonPath.stringAt('$.inputUri'),
    });
    const waitForJob = new sfn.Wait(this, 'WaitForEmrServerlessJob', {
      time: sfn.WaitTime.duration(Duration.seconds(30)),
    });
    const checkJob = invoke('CheckEmrServerlessJob', 'CHECK_JOB', {
      runId: sfn.JsonPath.stringAt('$.runId'),
      jobRunId: sfn.JsonPath.stringAt('$.jobRunId'),
    });
    const jobFailed = new sfn.Fail(this, 'EmrServerlessJobFailed', {
      error: 'EmrServerlessJobFailed',
      cause: 'EMR Serverless Spark job did not complete successfully.',
    });
    const completed = new sfn.Succeed(this, 'AnalyticsRefreshCompleted');

    const jobStatus = new sfn.Choice(this, 'IsEmrServerlessJobComplete')
      .when(sfn.Condition.stringEquals('$.status', 'SUCCESS'), completed)
      .when(
        sfn.Condition.or(
          sfn.Condition.stringEquals('$.status', 'FAILED'),
          sfn.Condition.stringEquals('$.status', 'CANCELLED'),
          sfn.Condition.stringEquals('$.status', 'CANCELLING'),
        ),
        jobFailed,
      )
      .otherwise(waitForJob);
    waitForJob.next(checkJob);
    checkJob.next(jobStatus);
    startJob.next(waitForJob);

    const exportStatus = new sfn.Choice(this, 'IsDynamoDbExportComplete')
      .when(sfn.Condition.stringEquals('$.status', 'COMPLETED'), startJob)
      .when(sfn.Condition.stringEquals('$.status', 'FAILED'), exportFailed)
      .otherwise(waitForExport);
    waitForExport.next(checkExport);
    checkExport.next(exportStatus);
    startExport.next(waitForExport);

    const workflowLogGroup = new logs.LogGroup(
      this,
      'AnalyticsStateMachineLogGroup',
      {
        logGroupName: `/aws/vendedlogs/states/${prefix}-analytics-refresh`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      },
    );
    const stateMachine = new sfn.StateMachine(
      this,
      'AnalyticsStateMachine',
      {
        stateMachineName: `${prefix}-analytics-refresh`,
        stateMachineType: sfn.StateMachineType.STANDARD,
        definitionBody: sfn.DefinitionBody.fromChainable(startExport),
        timeout: Duration.hours(2),
        tracingEnabled: true,
        logs: {
          destination: workflowLogGroup,
          level: sfn.LogLevel.ALL,
          includeExecutionData: true,
        },
        role: labRole,
      },
    );

    return { application, jobRole, entryPoint, stateMachine };
  }

  private createContainerService(input: {
    prefix: string;
    table: dynamodb.Table;
    deliveryProofBucket: s3.Bucket;
    corsAllowedOrigins: string[];
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    analyticsBucket: s3.Bucket;
    analyticsStateMachine: sfn.StateMachine;
    realtimeApi: apigwv2.WebSocketApi;
    webSocketPublicUrl: string;
    webSocketManagementEndpoint: string;
    trackingBaseUrl: string;
    applicationSecret: secretsmanager.Secret;
    labRole: iam.IRole;
  }): {
    listener: elbv2.ApplicationListener;
    vpc: ec2.Vpc;
    vpcLinkSecurityGroup: ec2.SecurityGroup;
  } {
    const {
      prefix,
      table,
      deliveryProofBucket,
      corsAllowedOrigins,
      userPool,
      userPoolClient,
      analyticsBucket,
      analyticsStateMachine,
      realtimeApi,
      webSocketPublicUrl,
      webSocketManagementEndpoint,
      trackingBaseUrl,
      applicationSecret,
      labRole,
    } = input;

    // Public task IPs provide outbound access without a NAT Gateway in dev.
    // The task port is still reachable only from the internal ALB security group.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${prefix}-vpc`,
      availabilityZones: [`${this.region}a`, `${this.region}b`],
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${prefix}-cluster`,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc,
      description: 'Allows backend traffic only from the internal ALB.',
      allowAllOutbound: true,
    });
    const loadBalancerSecurityGroup = new ec2.SecurityGroup(
      this,
      'LoadBalancerSecurityGroup',
      {
        vpc,
        description: 'Allows API Gateway VPC Link traffic to the internal ALB.',
        allowAllOutbound: true,
      },
    );
    const vpcLinkSecurityGroup = new ec2.SecurityGroup(
      this,
      'VpcLinkSecurityGroup',
      {
        vpc,
        description: 'API Gateway VPC Link network interfaces.',
        allowAllOutbound: true,
      },
    );

    loadBalancerSecurityGroup.addIngressRule(
      vpcLinkSecurityGroup,
      ec2.Port.tcp(80),
      'HTTP from API Gateway VPC Link',
    );
    taskSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(3000),
      'Node.js API from ALB',
    );

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'ApiTaskDefinition',
      {
        family: `${prefix}-api`,
        cpu: 512,
        memoryLimitMiB: 1024,
        taskRole: labRole,
        executionRole: labRole,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      },
    );
    const container = taskDefinition.addContainer('ApiContainer', {
      containerName: 'api',
      image: ecs.ContainerImage.fromAsset(projectRoot, {
        file: 'Dockerfile',
        platform: ecrAssets.Platform.LINUX_AMD64,
      }),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'api',
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        NODE_ENV: 'production',
        PORT: '3000',
        AWS_REGION: this.region,
        DYNAMODB_TABLE_NAME: table.tableName,
        S3_DELIVERY_PROOF_BUCKET: deliveryProofBucket.bucketName,
        S3_ANALYTICS_BUCKET: analyticsBucket.bucketName,
        ANALYTICS_STATE_MACHINE_ARN: analyticsStateMachine.stateMachineArn,
        WEBSOCKET_PUBLIC_URL: webSocketPublicUrl,
        WEBSOCKET_MANAGEMENT_ENDPOINT: webSocketManagementEndpoint,
        TRACKING_BASE_URL: trackingBaseUrl,
        CORS_ALLOWED_ORIGINS: corsAllowedOrigins.join(','),
        AUTH_MODE: 'cognito',
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        ROUTING_PROVIDER: process.env.CLOUDFLEET_ROUTING_PROVIDER?.trim() || 'straight-line',
        ROUTING_BASE_URL: process.env.CLOUDFLEET_ROUTING_BASE_URL?.trim() || 'https://router.project-osrm.org',
        ROUTING_ORIGIN_LAT: process.env.CLOUDFLEET_ROUTING_ORIGIN_LAT?.trim() || '10.7769',
        ROUTING_ORIGIN_LNG: process.env.CLOUDFLEET_ROUTING_ORIGIN_LNG?.trim() || '106.7009',
        OBSERVABILITY_ENVIRONMENT: prefix,
        METRICS_SERVICE_NAME: 'cloudfleet-api',
      },
      secrets: {
        VAPID_PUBLIC_KEY: ecs.Secret.fromSecretsManager(applicationSecret, 'vapidPublicKey'),
        VAPID_PRIVATE_KEY: ecs.Secret.fromSecretsManager(applicationSecret, 'vapidPrivateKey'),
        VAPID_SUBJECT: ecs.Secret.fromSecretsManager(applicationSecret, 'vapidSubject'),
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          "node -e \"fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"",
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(20),
      },
    });
    container.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
      name: 'http',
    });

    table.grantReadWriteData(taskDefinition.taskRole);
    deliveryProofBucket.grantReadWrite(taskDefinition.taskRole);
    analyticsBucket.grantRead(taskDefinition.taskRole);
    analyticsStateMachine.grantStartExecution(taskDefinition.taskRole);
    analyticsStateMachine.grantRead(taskDefinition.taskRole);
    realtimeApi.grantManageConnections(taskDefinition.taskRole);

    const service = new ecs.FargateService(this, 'ApiService', {
      serviceName: `${prefix}-api`,
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [taskSecurityGroup],
      enableExecuteCommand: true,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });

    const scaling = service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 4,
    });
    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 60,
      scaleInCooldown: Duration.seconds(120),
      scaleOutCooldown: Duration.seconds(60),
    });

    const loadBalancer = new elbv2.ApplicationLoadBalancer(
      this,
      'InternalLoadBalancer',
      {
        loadBalancerName: `${prefix}-internal`,
        vpc,
        internetFacing: false,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        securityGroup: loadBalancerSecurityGroup,
      },
    );
    const listener = loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
    });
    listener.addTargets('ApiTarget', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [
        service.loadBalancerTarget({
          containerName: 'api',
          containerPort: 3000,
        }),
      ],
      healthCheck: {
        path: '/health',
        healthyHttpCodes: '200',
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
      },
      deregistrationDelay: Duration.seconds(30),
    });

    return { listener, vpc, vpcLinkSecurityGroup };
  }

  private createHttpApi(input: {
    prefix: string;
    listener: elbv2.ApplicationListener;
    vpc: ec2.Vpc;
    vpcLinkSecurityGroup: ec2.SecurityGroup;
    userPool: cognito.UserPool;
    userPoolClient: cognito.UserPoolClient;
    corsAllowedOrigins: string[];
  }): apigwv2.HttpApi {
    const {
      prefix,
      listener,
      vpc,
      vpcLinkSecurityGroup,
      userPool,
      userPoolClient,
      corsAllowedOrigins,
    } = input;
    const vpcLink = new apigwv2.VpcLink(this, 'ApiVpcLink', {
      vpc,
      vpcLinkName: `${prefix}-api`,
      subnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [vpcLinkSecurityGroup],
    });
    const integration = new HttpAlbIntegration('ApiAlbIntegration', listener, {
      vpcLink,
      parameterMapping: new apigwv2.ParameterMapping().overwritePath(
        apigwv2.MappingValue.requestPath(),
      ),
    });
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${prefix}-api`,
      description: 'CloudFleet public HTTP API backed by ECS Fargate.',
      corsPreflight: {
        allowOrigins: corsAllowedOrigins,
        allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-ID'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        maxAge: Duration.minutes(10),
      },
    });
    const authorizer = new HttpJwtAuthorizer(
      'CognitoJwtAuthorizer',
      `https://cognito-idp.${this.region}.${this.urlSuffix}/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );

    httpApi.addRoutes({
      path: '/health',
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });
    httpApi.addRoutes({
      path: '/api/tracking/{trackingToken}',
      methods: [apigwv2.HttpMethod.GET],
      integration,
    });
    httpApi.addRoutes({
      path: '/api/tracking/{trackingToken}/feedback',
      methods: [apigwv2.HttpMethod.POST],
      integration,
    });
    httpApi.addRoutes({
      path: '/api/tracking/{trackingToken}/reschedule',
      methods: [apigwv2.HttpMethod.POST],
      integration,
    });
    httpApi.addRoutes({
      path: '/api/telemetry/frontend',
      methods: [apigwv2.HttpMethod.POST],
      integration,
    });
    httpApi.addRoutes({
      path: '/api',
      methods: [apigwv2.HttpMethod.ANY],
      integration,
      authorizer,
    });
    httpApi.addRoutes({
      path: '/api/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration,
      authorizer,
    });

    return httpApi;
  }

  private createObservabilityDashboard(prefix: string): cloudwatch.Dashboard {
    const search = (
      metricName: string,
      statistic: string,
      dimensionNames: string,
      label: string,
    ): cloudwatch.MathExpression => new cloudwatch.MathExpression({
      expression: `SEARCH('{CloudFleet/Observability,${dimensionNames}} MetricName="${metricName}" Environment="${prefix}"', '${statistic}', 300)`,
      label,
      period: Duration.minutes(5),
    });
    const graph = (
      title: string,
      metrics: cloudwatch.IMetric[],
      width = 12,
    ): cloudwatch.GraphWidget => new cloudwatch.GraphWidget({
      title,
      left: metrics,
      width,
      height: 6,
      leftYAxis: { min: 0 },
      view: cloudwatch.GraphWidgetView.TIME_SERIES,
    });

    const dashboard = new cloudwatch.Dashboard(this, 'ObservabilityDashboard', {
      dashboardName: `${prefix}-performance`,
      defaultInterval: Duration.hours(3),
    });
    dashboard.addWidgets(
      graph('Endpoint latency p95', [
        search('HttpRequestDuration', 'p95', 'Service,Environment,Method,Route', 'p95 latency'),
      ]),
      graph('Endpoint throughput and errors', [
        search('HttpRequestCount', 'Sum', 'Service,Environment,Method,Route', 'requests'),
        search('HttpErrorCount', 'Sum', 'Service,Environment,Method,Route', 'errors'),
        search('HttpErrorRate', 'Average', 'Service,Environment,Method,Route', 'error rate %'),
      ]),
      graph('DynamoDB latency', [
        search('DynamoDBRequestDuration', 'p95', 'Service,Environment,Dependency,Operation', 'p95 DynamoDB'),
      ]),
      graph('DynamoDB consumed capacity', [
        search('DynamoDBConsumedCapacity', 'Sum', 'Service,Environment,Dependency,Operation', 'capacity units'),
        search('DynamoDBScannedItemCount', 'Sum', 'Service,Environment,Dependency,Operation', 'scanned items'),
        search('DynamoDBReturnedItemCount', 'Sum', 'Service,Environment,Dependency,Operation', 'returned items'),
      ]),
      graph('Routing, geocoding and optimization latency', [
        search('RoutingProviderDuration', 'p95', 'Service,Environment,Provider,Operation,Outcome', 'OSRM p95'),
        search('GeocodingDuration', 'p95', 'Service,Environment,Provider,Cache,Outcome', 'geocoding p95'),
        search('RouteOptimizationDuration', 'p95', 'Service,Environment,Mode,StopBucket', 'optimization p95'),
        search('RoutePlanningDuration', 'p95', 'Service,Environment,Provider,StopBucket', 'route plan p95'),
      ]),
      graph('POD upload and registration', [
        search('PodUploadDuration', 'p95', 'Service,Environment,Outcome', 'browser → S3 p95'),
        search('S3ProofVerifyDuration', 'p95', 'Service,Environment,Outcome', 'S3 verify p95'),
        search('ProofRegisterDuration', 'p95', 'Service,Environment,Outcome', 'register p95'),
      ]),
      graph('Push and SMS outcomes', [
        search('PushSuccessCount', 'Sum', 'Service,Environment,Provider,Outcome', 'push success'),
        search('PushFailureCount', 'Sum', 'Service,Environment,Provider,Outcome', 'push failure'),
        search('PushSuccessRate', 'Average', 'Service,Environment,Provider', 'push success %'),
        search('SmsSuccessCount', 'Sum', 'Service,Environment,Provider,Outcome', 'SMS success'),
        search('SmsFailureCount', 'Sum', 'Service,Environment,Provider,Outcome', 'SMS failure'),
        search('SmsSuccessRate', 'Average', 'Service,Environment,Provider', 'SMS success %'),
      ]),
      graph('Frontend Web Vitals p75', [
        search('WebVitalLCP', 'p75', 'Service,Environment,Vital,Rating,Page,DeviceType', 'LCP'),
        search('WebVitalINP', 'p75', 'Service,Environment,Vital,Rating,Page,DeviceType', 'INP'),
        search('WebVitalCLS', 'p75', 'Service,Environment,Vital,Rating,Page,DeviceType', 'CLS'),
      ]),
      graph('Offline outbox health', [
        search('OfflineOutboxSize', 'Maximum', 'Service,Environment,Event', 'max queue size'),
        search('OfflineOutboxRetryCount', 'Sum', 'Service,Environment,Event', 'retries'),
        search('OfflineOutboxConflictCount', 'Sum', 'Service,Environment,Event', 'conflicts'),
      ]),
    );
    return dashboard;
  }

  private parseCorsOrigins(): string[] {
    const configured = this.node.tryGetContext('corsAllowedOrigins') as
      | string
      | undefined;
    const origins = (configured ?? 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (origins.length === 0) {
      throw new Error('At least one corsAllowedOrigins value is required');
    }

    return origins;
  }
}
