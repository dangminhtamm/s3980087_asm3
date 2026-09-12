import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface IdentityProps {
  prefix: string;
  account: string;
  removalPolicy: RemovalPolicy;
  allowedOrigins: string[];
}

export class Identity extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly applicationSecret: secretsmanager.Secret;

  public constructor(scope: Construct, id: string, props: IdentityProps) {
    super(scope, id);
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${props.prefix}-users`,
      selfSignUpEnabled: false,
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
      removalPolicy: props.removalPolicy,
    });
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'ADMIN',
      description: 'CloudFleet administrators and dispatchers',
      precedence: 1,
    });
    new cognito.CfnUserPoolGroup(this, 'DriverGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'DRIVER',
      description: 'CloudFleet delivery drivers',
      precedence: 2,
    });
    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${props.prefix}-web`,
      generateSecret: false,
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: props.allowedOrigins.map((origin) => `${origin}/auth/callback`),
        logoutUrls: props.allowedOrigins.map((origin) => `${origin}/`),
      },
    });
    this.userPoolDomain = this.userPool.addDomain('HostedDomain', {
      cognitoDomain: { domainPrefix: `${props.prefix}-${props.account}`.toLowerCase() },
    });
    this.applicationSecret = new secretsmanager.Secret(this, 'ApplicationSecret', {
      secretName: `${props.prefix}/application-secrets`,
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
      removalPolicy: props.removalPolicy,
    });
  }
}
