import path from 'node:path';

import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

import { projectRoot } from '../project-paths.js';

export interface OperationalDataProps {
  prefix: string;
  removalPolicy: RemovalPolicy;
}

export class OperationalData extends Construct {
  public readonly table: dynamodb.Table;

  public constructor(scope: Construct, id: string, props: OperationalDataProps) {
    super(scope, id);
    this.table = new dynamodb.Table(this, 'OperationalTable', {
      tableName: `${props.prefix}-operations`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'expiresAt',
      removalPolicy: props.removalPolicy,
    });
    for (const index of ['GSI1', 'GSI2']) {
      this.table.addGlobalSecondaryIndex({
        indexName: index,
        partitionKey: { name: `${index}PK`, type: dynamodb.AttributeType.STRING },
        sortKey: { name: `${index}SK`, type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      });
    }
  }

  public addNotificationWorker(input: {
    prefix: string;
    applicationSecret: secretsmanager.Secret;
    labRole: iam.IRole;
    trackingBaseUrl: string;
  }): lambdaNodejs.NodejsFunction {
    const functionName = `${input.prefix}-delivery-notification`;
    const logGroup = new logs.LogGroup(this, 'DeliveryNotificationLogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const worker = new lambdaNodejs.NodejsFunction(this, 'DeliveryNotificationFunction', {
      functionName,
      description: 'Sends secure customer tracking links on delivery status changes.',
      entry: path.join(projectRoot, 'src/lambdas/delivery-notification/lambda-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(15),
      logGroup,
      role: input.labRole,
      projectRoot,
      environment: {
        APP_SECRET_ARN: input.applicationSecret.secretArn,
        DYNAMODB_TABLE_NAME: this.table.tableName,
        TRACKING_BASE_URL: input.trackingBaseUrl,
        OBSERVABILITY_ENVIRONMENT: input.prefix,
        METRICS_SERVICE_NAME: 'cloudfleet-notification',
      },
      bundling: { minify: true, sourceMap: true, target: 'node22' },
    });
    input.applicationSecret.grantRead(worker);
    this.table.grantReadWriteData(worker);
    worker.addEventSource(
      new lambdaEventSources.DynamoEventSource(this.table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(2),
        bisectBatchOnError: true,
        retryAttempts: 3,
        reportBatchItemFailures: true,
      }),
    );
    worker.node.addDependency(this.table);
    return worker;
  }
}
