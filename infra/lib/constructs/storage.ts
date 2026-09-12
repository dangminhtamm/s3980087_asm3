import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StorageProps {
  prefix: string;
  account: string;
  isProduction: boolean;
  removalPolicy: RemovalPolicy;
}

export class Storage extends Construct {
  public readonly frontendBucket: s3.Bucket;
  public readonly deliveryProofBucket: s3.Bucket;
  public readonly analyticsBucket: s3.Bucket;

  public constructor(scope: Construct, id: string, props: StorageProps) {
    super(scope, id);
    const sharedProperties = {
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: props.removalPolicy,
      autoDeleteObjects: false,
    } as const;
    this.frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      ...sharedProperties,
      bucketName: `${props.prefix}-frontend-${props.account}`,
      versioned: props.isProduction,
    });
    this.deliveryProofBucket = new s3.Bucket(this, 'DeliveryProofBucket', {
      ...sharedProperties,
      bucketName: `${props.prefix}-delivery-proofs-${props.account}`,
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
    this.analyticsBucket = new s3.Bucket(this, 'AnalyticsBucket', {
      ...sharedProperties,
      bucketName: `${props.prefix}-analytics-${props.account}`,
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
  }

  public allowProofUploadsFrom(origins: string[]): void {
    this.deliveryProofBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.PUT],
      allowedOrigins: origins,
      allowedHeaders: ['Content-Type', 'x-amz-meta-orderid'],
      exposedHeaders: ['ETag'],
      maxAge: 3_600,
    });
  }
}
