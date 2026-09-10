# CloudFleet AWS CDK deployment

This CDK app deploys CloudFleet to `ap-southeast-1`. The backend request path is:

```text
Cognito JWT -> API Gateway HTTP API -> VPC Link -> internal ALB -> ECS Fargate
```

It also provisions:

- one DynamoDB single table with `GSI1`, `GSI2`, Streams and point-in-time recovery;
- one private S3 bucket for React assets behind CloudFront Origin Access Control;
- automatic React build/upload, CloudFront invalidation and SPA route fallback;
- a deployment-time `runtime-config.js` for API Gateway and Cognito settings;
- one private bucket for delivery proofs;
- one DynamoDB Stream Lambda event source with partial-batch reporting;
- Cognito `ADMIN` and `DRIVER` groups;
- API Gateway WebSocket API and a connection-management Lambda;
- an encrypted analytics bucket and EMR Serverless Spark application;
- a Step Functions workflow that exports DynamoDB and runs EMR automatically;
- Secrets Manager storage for Twilio and Web Push VAPID credentials;
- CloudWatch log groups and ECS CPU autoscaling.

## Prerequisites

- Node.js 22 or newer, with root, `frontend/` and `infra/` dependencies installed
- AWS CLI authenticated to the target account
- Docker Desktop or another Docker-compatible daemon
- AWS CDK bootstrap/deployment permissions

The deployment principal must be able to deploy CloudFormation resources for
S3, CloudFront, ECR, ECS, EC2/VPC, ELB, API Gateway, Cognito, DynamoDB, Lambda,
EMR Serverless, Step Functions, Secrets Manager, CloudWatch Logs, SSM and
Application Auto Scaling.

## AWS Academy / VocLabs IAM model

The stack imports the lab-provided role at
`arn:aws:iam::<current-account-id>:role/LabRole` and reuses it as:

- every Lambda execution role, including CDK deployment custom resources;
- the ECS task role and task execution role;
- the Step Functions execution role;
- the EMR Serverless Spark job runtime role.

`LabRole` is imported as immutable, so this stack neither creates IAM roles nor
attaches policies to the existing role. The synthesized template has no
`AWS::IAM::Role` or `AWS::IAM::Policy` resource. Consequently, the LabRole
provided by the active Learner Lab must already have the required permissions
and trust relationships for Lambda, ECS tasks, Step Functions and EMR
Serverless. In particular, the analytics workflow needs DynamoDB export, S3,
EMR Serverless job-control and `iam:PassRole` access for LabRole itself.

This application uses **EMR Serverless**, not a classic EMR cluster. Therefore
`EMR_DefaultRole` (cluster service role) and `EMR_EC2_DefaultRole` (EC2 instance
profile) are not valid properties of this stack's EMR application. LabRole is
instead passed to every Spark job as its EMR Serverless runtime role. Switching
to those two legacy cluster roles would require replacing EMR Serverless with
an EC2-backed EMR cluster and rewriting the analytics workflow.

Automatic S3 object deletion is disabled because that CDK feature creates an
additional IAM-backed custom resource. Empty the development buckets manually
before running `cdk destroy`.

## Verify and synthesize

```bash
cd infra
npm ci
npm --prefix ../frontend ci
npm run typecheck

CDK_DEFAULT_ACCOUNT=891709159290 \
CDK_DEFAULT_REGION=ap-southeast-1 \
npm run synth
```

The committed `cdk.context.json` prevents synthesis from requiring
`ec2:DescribeAvailabilityZones` for this account and region.

## Bootstrap once per account and region

```bash
cd infra
npm run bootstrap -- aws://891709159290/ap-southeast-1
```

## Deploy the dev stack

Start Docker before deploying because CDK builds and publishes the backend
container image to its bootstrap ECR asset repository. `npm run deploy`
automatically builds the React app, uploads it to the private frontend bucket,
and invalidates CloudFront.

The frontend uses public OpenStreetMap tiles through Leaflet, so no map API key
or production map environment variable is required. Never put server-side AWS
or Twilio credentials in a `VITE_*` variable.

```bash
cd infra
npm run deploy -- \
  --context stage=dev
```

The stack automatically adds its generated CloudFront origin to API Gateway,
S3 upload and Cognito callback/logout allowlists. The `corsAllowedOrigins`
context is only for additional origins such as local development URLs.

The API routes under `/api` require a valid Cognito access token except the
opaque token-scoped customer tracking, feedback and reschedule routes. `GET
/health` is intentionally public for ECS and load-balancer health checks.

## Configure provider credentials

After deployment, open the Secrets Manager secret shown by the
`ApplicationSecretArn` output and replace these placeholders:

- `twilioAccountSid`
- `twilioAuthToken`
- `twilioFromNumber`
- `vapidPublicKey`
- `vapidPrivateKey`
- `vapidSubject`

Do not store these values in `.env`, CDK context, source control or
CloudFormation parameters.

## Outputs

The stack exports `FrontendUrl`, the CloudFront distribution ID, REST and
WebSocket URLs, DynamoDB table name, S3 bucket names, Cognito pool/client IDs,
Hosted UI URL, EMR application/job information, the analytics state machine
ARN, and the application secret ARN.

Open `FrontendUrl` after deployment. CDK writes the API Gateway and Cognito
outputs into `runtime-config.js`; no manual production `.env` copy is required.
CloudFront serves the app over HTTPS, redirects HTTP, compresses static assets,
adds managed security headers, and maps S3 403/404 responses to `index.html` so
React Router deep links such as `/admin/orders` continue to work. Price Class
200 includes edge locations in Vietnam and nearby Asian regions.

Create users administratively and assign each user to exactly one of the
`ADMIN` or `DRIVER` Cognito groups. Group membership is emitted in the access
token and enforced by Express route middleware. Create DRIVER users with a
Cognito username equal to the corresponding DynamoDB `driverId` so order
ownership checks can be enforced.

## Development cost profile

The dev stack intentionally uses public-IP Fargate tasks with security-group
restricted ingress and no NAT Gateway. The ALB remains internal and can only be
reached through API Gateway's VPC Link. Fargate, ALB, VPC Link, CloudWatch and
other resources can still incur charges while the stack exists.
