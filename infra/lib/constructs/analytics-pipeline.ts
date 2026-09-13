import path from 'node:path';

import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as emrserverless from 'aws-cdk-lib/aws-emrserverless';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfnTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

import { projectRoot } from '../project-paths.js';
import type { DeploymentTarget } from '../deployment-config.js';

export interface AnalyticsPipelineProps {
  prefix: string;
  table: dynamodb.Table;
  analyticsBucket: s3.Bucket;
  labRole: iam.IRole;
  target: DeploymentTarget;
}

export class AnalyticsPipeline extends Construct {
  public readonly application?: emrserverless.CfnApplication;
  public readonly glueJob?: glue.CfnJob;
  public readonly jobRole: iam.IRole;
  public readonly entryPoint: string;
  public readonly stateMachine: sfn.StateMachine;

  public constructor(scope: Construct, id: string, props: AnalyticsPipelineProps) {
    super(scope, id);
    new s3deploy.BucketDeployment(this, 'AnalyticsJobDeployment', {
      destinationBucket: props.analyticsBucket,
      destinationKeyPrefix: 'analytics/jobs',
      sources: [s3deploy.Source.asset(path.join(projectRoot, 'analytics/emr/jobs'))],
      prune: false,
      role: props.labRole,
    });
    this.jobRole = props.labRole;
    this.entryPoint = `s3://${props.analyticsBucket.bucketName}/analytics/jobs/delivery_performance.py`;
    const workflowEnvironment: Record<string, string> = {
      TABLE_ARN: props.table.tableArn,
      ANALYTICS_BUCKET: props.analyticsBucket.bucketName,
    };
    if (props.target === 'learner-lab') {
      this.glueJob = new glue.CfnJob(this, 'AnalyticsGlueJob', {
        name: `${props.prefix}-delivery-analytics`,
        role: this.jobRole.roleArn,
        command: {
          name: 'glueetl',
          pythonVersion: '3',
          scriptLocation: this.entryPoint,
        },
        defaultArguments: {
          '--job-language': 'python',
          '--enable-metrics': 'true',
          '--enable-continuous-cloudwatch-log': 'true',
          '--TempDir': `s3://${props.analyticsBucket.bucketName}/glue-temp/`,
        },
        executionProperty: { maxConcurrentRuns: 1 },
        glueVersion: '4.0',
        maxRetries: 0,
        numberOfWorkers: 2,
        timeout: 60,
        workerType: 'G.1X',
      });
      workflowEnvironment.ANALYTICS_ENGINE = 'glue';
      workflowEnvironment.GLUE_JOB_NAME = this.glueJob.ref;
    } else {
      this.application = new emrserverless.CfnApplication(this, 'AnalyticsApplication', {
        name: `${props.prefix}-delivery-analytics`,
        type: 'SPARK',
        releaseLabel: 'emr-7.13.0',
        autoStartConfiguration: { enabled: true },
        autoStopConfiguration: { enabled: true, idleTimeoutMinutes: 15 },
      });
      workflowEnvironment.ANALYTICS_ENGINE = 'emr-serverless';
      workflowEnvironment.EMR_APPLICATION_ID = this.application.attrApplicationId;
      workflowEnvironment.EMR_JOB_ROLE_ARN = this.jobRole.roleArn;
      workflowEnvironment.EMR_ENTRY_POINT = this.entryPoint;
    }
    const workflowFunctionName = `${props.prefix}-analytics-workflow`;
    const functionLogGroup = new logs.LogGroup(this, 'AnalyticsWorkflowFunctionLogGroup', {
      logGroupName: `/aws/lambda/${workflowFunctionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const workflowFunction = new lambdaNodejs.NodejsFunction(this, 'AnalyticsWorkflowFunction', {
      functionName: workflowFunctionName,
      description: 'Exports DynamoDB and controls the CloudFleet Spark analytics job.',
      entry: path.join(projectRoot, 'src/lambdas/analytics-workflow/lambda-handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      logGroup: functionLogGroup,
      role: props.labRole,
      projectRoot,
      environment: workflowEnvironment,
      bundling: { minify: true, sourceMap: true, target: 'node22' },
    });

    const invoke = (
      id: string,
      action: string,
      fields: Record<string, string>,
    ): sfnTasks.LambdaInvoke =>
      new sfnTasks.LambdaInvoke(this, id, {
        lambdaFunction: workflowFunction,
        payloadResponseOnly: true,
        payload: sfn.TaskInput.fromObject({ action, ...fields }),
      });
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
    const startJob = invoke('StartSparkJob', 'START_JOB', {
      runId: sfn.JsonPath.stringAt('$.runId'),
      inputUri: sfn.JsonPath.stringAt('$.inputUri'),
    });
    const waitForJob = new sfn.Wait(this, 'WaitForSparkJob', {
      time: sfn.WaitTime.duration(Duration.seconds(30)),
    });
    const checkJob = invoke('CheckSparkJob', 'CHECK_JOB', {
      runId: sfn.JsonPath.stringAt('$.runId'),
      jobRunId: sfn.JsonPath.stringAt('$.jobRunId'),
    });
    const jobFailed = new sfn.Fail(this, 'SparkJobFailed', {
      error: 'SparkJobFailed',
      cause: 'The analytics Spark job did not complete successfully.',
    });
    const completed = new sfn.Succeed(this, 'AnalyticsRefreshCompleted');
    const jobStatus = new sfn.Choice(this, 'IsSparkJobComplete')
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
    const workflowLogGroup = new logs.LogGroup(this, 'AnalyticsStateMachineLogGroup', {
      logGroupName: `/aws/vendedlogs/states/${props.prefix}-analytics-refresh`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.stateMachine = new sfn.StateMachine(this, 'AnalyticsStateMachine', {
      stateMachineName: `${props.prefix}-analytics-refresh`,
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(startExport),
      timeout: Duration.hours(2),
      tracingEnabled: true,
      logs: {
        destination: workflowLogGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
      role: props.labRole,
    });
  }
}
