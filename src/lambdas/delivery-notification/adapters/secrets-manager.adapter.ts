import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export interface TwilioConfiguration {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export interface TwilioConfigurationPort {
  get(): Promise<TwilioConfiguration>;
}

const requiredEnvironment = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

export class SecretsManagerTwilioConfiguration implements TwilioConfigurationPort {
  private configurationPromise?: Promise<TwilioConfiguration>;

  constructor(
    private readonly client: SecretsManagerClient,
    private readonly environment: NodeJS.ProcessEnv,
  ) {}

  get(): Promise<TwilioConfiguration> {
    const secretArn = this.environment.APP_SECRET_ARN?.trim();
    if (!secretArn) {
      return Promise.resolve({
        accountSid: requiredEnvironment(this.environment, 'TWILIO_ACCOUNT_SID'),
        authToken: requiredEnvironment(this.environment, 'TWILIO_AUTH_TOKEN'),
        fromNumber: requiredEnvironment(this.environment, 'TWILIO_FROM_NUMBER'),
      });
    }

    this.configurationPromise ??= this.client
      .send(new GetSecretValueCommand({ SecretId: secretArn }))
      .then((result) => {
        if (!result.SecretString) {
          throw new Error('Application secret does not contain a SecretString');
        }
        const value = JSON.parse(result.SecretString) as Record<string, unknown>;
        if (
          typeof value.twilioAccountSid !== 'string' ||
          typeof value.twilioAuthToken !== 'string' ||
          typeof value.twilioFromNumber !== 'string'
        ) {
          throw new Error('Application secret has invalid Twilio fields');
        }
        return {
          accountSid: value.twilioAccountSid,
          authToken: value.twilioAuthToken,
          fromNumber: value.twilioFromNumber,
        };
      });
    return this.configurationPromise;
  }
}
