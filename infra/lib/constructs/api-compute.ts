import { Duration, Stack } from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpAlbIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

import type { RoutingDeploymentConfig } from '../deployment-config.js';
import { projectRoot } from '../project-paths.js';

export interface ApiComputeProps {
  prefix: string;
  table: dynamodb.Table;
  deliveryProofBucket: s3.Bucket;
  analyticsBucket: s3.Bucket;
  analyticsStateMachine: sfn.StateMachine;
  realtimeApi: apigwv2.WebSocketApi;
  webSocketPublicUrl: string;
  webSocketManagementEndpoint: string;
  trackingBaseUrl: string;
  corsAllowedOrigins: string[];
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  applicationSecret: secretsmanager.Secret;
  labRole: iam.IRole;
  routing: RoutingDeploymentConfig;
}

interface ServiceNetwork {
  listener: elbv2.ApplicationListener;
  vpc: ec2.Vpc;
  vpcLinkSecurityGroup: ec2.SecurityGroup;
}

export class ApiCompute extends Construct {
  public readonly httpApi: apigwv2.HttpApi;

  public constructor(scope: Construct, id: string, props: ApiComputeProps) {
    super(scope, id);
    const network = this.createService(props);
    this.httpApi = this.createHttpApi(props, network);
  }

  private createService(props: ApiComputeProps): ServiceNetwork {
    const stack = Stack.of(this);
    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${props.prefix}-vpc`,
      availabilityZones: [`${stack.region}a`, `${stack.region}b`],
      natGateways: 0,
      subnetConfiguration: [{ name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
    });
    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${props.prefix}-cluster`,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    const taskSecurityGroup = new ec2.SecurityGroup(this, 'TaskSecurityGroup', {
      vpc,
      description: 'Allows backend traffic only from the internal ALB.',
      allowAllOutbound: true,
    });
    const loadBalancerSecurityGroup = new ec2.SecurityGroup(this, 'LoadBalancerSecurityGroup', {
      vpc,
      description: 'Allows API Gateway VPC Link traffic to the internal ALB.',
      allowAllOutbound: true,
    });
    const vpcLinkSecurityGroup = new ec2.SecurityGroup(this, 'VpcLinkSecurityGroup', {
      vpc,
      description: 'API Gateway VPC Link network interfaces.',
      allowAllOutbound: true,
    });
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
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'ApiTaskDefinition', {
      family: `${props.prefix}-api`,
      cpu: 512,
      memoryLimitMiB: 1024,
      taskRole: props.labRole,
      executionRole: props.labRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
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
        AWS_REGION: stack.region,
        DYNAMODB_TABLE_NAME: props.table.tableName,
        S3_DELIVERY_PROOF_BUCKET: props.deliveryProofBucket.bucketName,
        S3_ANALYTICS_BUCKET: props.analyticsBucket.bucketName,
        ANALYTICS_STATE_MACHINE_ARN: props.analyticsStateMachine.stateMachineArn,
        WEBSOCKET_PUBLIC_URL: props.webSocketPublicUrl,
        WEBSOCKET_MANAGEMENT_ENDPOINT: props.webSocketManagementEndpoint,
        TRACKING_BASE_URL: props.trackingBaseUrl,
        CORS_ALLOWED_ORIGINS: props.corsAllowedOrigins.join(','),
        AUTH_MODE: 'cognito',
        COGNITO_USER_POOL_ID: props.userPool.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
        ROUTING_PROVIDER: props.routing.provider,
        ROUTING_BASE_URL: props.routing.baseUrl,
        ROUTING_ORIGIN_LAT: props.routing.originLatitude,
        ROUTING_ORIGIN_LNG: props.routing.originLongitude,
        OBSERVABILITY_ENVIRONMENT: props.prefix,
        METRICS_SERVICE_NAME: 'cloudfleet-api',
      },
      secrets: {
        VAPID_PUBLIC_KEY: ecs.Secret.fromSecretsManager(props.applicationSecret, 'vapidPublicKey'),
        VAPID_PRIVATE_KEY: ecs.Secret.fromSecretsManager(
          props.applicationSecret,
          'vapidPrivateKey',
        ),
        VAPID_SUBJECT: ecs.Secret.fromSecretsManager(props.applicationSecret, 'vapidSubject'),
      },
      healthCheck: {
        command: [
          'CMD-SHELL',
          'node -e "fetch(\'http://127.0.0.1:3000/health\').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"',
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(20),
      },
    });
    container.addPortMappings({ containerPort: 3000, protocol: ecs.Protocol.TCP, name: 'http' });
    props.table.grantReadWriteData(taskDefinition.taskRole);
    props.deliveryProofBucket.grantReadWrite(taskDefinition.taskRole);
    props.analyticsBucket.grantRead(taskDefinition.taskRole);
    props.analyticsStateMachine.grantStartExecution(taskDefinition.taskRole);
    props.analyticsStateMachine.grantRead(taskDefinition.taskRole);
    props.realtimeApi.grantManageConnections(taskDefinition.taskRole);
    const service = new ecs.FargateService(this, 'ApiService', {
      serviceName: `${props.prefix}-api`,
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
    service
      .autoScaleTaskCount({ minCapacity: 1, maxCapacity: 4 })
      .scaleOnCpuUtilization('CpuScaling', {
        targetUtilizationPercent: 60,
        scaleInCooldown: Duration.seconds(120),
        scaleOutCooldown: Duration.seconds(60),
      });
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'InternalLoadBalancer', {
      loadBalancerName: `${props.prefix}-internal`,
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: loadBalancerSecurityGroup,
    });
    const listener = loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
    });
    listener.addTargets('ApiTarget', {
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service.loadBalancerTarget({ containerName: 'api', containerPort: 3000 })],
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

  private createHttpApi(props: ApiComputeProps, network: ServiceNetwork): apigwv2.HttpApi {
    const stack = Stack.of(this);
    const vpcLink = new apigwv2.VpcLink(this, 'VpcLink', {
      vpc: network.vpc,
      vpcLinkName: `${props.prefix}-api`,
      subnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [network.vpcLinkSecurityGroup],
    });
    const integration = new HttpAlbIntegration('AlbIntegration', network.listener, {
      vpcLink,
      parameterMapping: new apigwv2.ParameterMapping().overwritePath(
        apigwv2.MappingValue.requestPath(),
      ),
    });
    const api = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${props.prefix}-api`,
      description: 'CloudFleet public HTTP API backed by ECS Fargate.',
      corsPreflight: {
        allowOrigins: props.corsAllowedOrigins,
        allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-ID'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        maxAge: Duration.minutes(10),
      },
    });
    const authorizer = new HttpJwtAuthorizer(
      'CognitoJwtAuthorizer',
      `https://cognito-idp.${stack.region}.${stack.urlSuffix}/${props.userPool.userPoolId}`,
      { jwtAudience: [props.userPoolClient.userPoolClientId] },
    );
    for (const [path, method] of [
      ['/health', apigwv2.HttpMethod.GET],
      ['/api/tracking/{trackingToken}', apigwv2.HttpMethod.GET],
      ['/api/tracking/{trackingToken}/feedback', apigwv2.HttpMethod.POST],
      ['/api/tracking/{trackingToken}/reschedule', apigwv2.HttpMethod.POST],
      ['/api/telemetry/frontend', apigwv2.HttpMethod.POST],
    ] as const) {
      api.addRoutes({ path, methods: [method], integration });
    }
    for (const path of ['/api', '/api/{proxy+}']) {
      api.addRoutes({ path, methods: [apigwv2.HttpMethod.ANY], integration, authorizer });
    }
    return api;
  }
}
