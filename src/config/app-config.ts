import { z } from 'zod';

const trimmedOptionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined),
  z.string().optional(),
);

const requiredString = (name: string) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().min(1, `${name} is required`),
  );

const numberFromEnvironment = (fallback: number, minimum: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : Number(value)),
    z.number().finite().min(minimum).max(maximum),
  );

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: numberFromEnvironment(3000, 1, 65_535).refine(Number.isInteger, {
      message: 'PORT must be an integer',
    }),
    CORS_ALLOWED_ORIGINS: z.string().default(''),
    AUTH_MODE: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
      z.enum(['disabled', 'cognito']).default('disabled'),
    ),
    COGNITO_USER_POOL_ID: trimmedOptionalString,
    COGNITO_CLIENT_ID: trimmedOptionalString,
    AWS_REGION: requiredString('AWS_REGION'),
    DYNAMODB_TABLE_NAME: requiredString('DYNAMODB_TABLE_NAME'),
    DYNAMODB_ENDPOINT: trimmedOptionalString,
    S3_DELIVERY_PROOF_BUCKET: requiredString('S3_DELIVERY_PROOF_BUCKET'),
    S3_ANALYTICS_BUCKET: trimmedOptionalString,
    S3_ENDPOINT: trimmedOptionalString,
    S3_PUBLIC_ENDPOINT: trimmedOptionalString,
    S3_FORCE_PATH_STYLE: z
      .preprocess(
        (value) => (value === undefined || value === '' ? 'false' : String(value).toLowerCase()),
        z.enum(['true', 'false']),
      )
      .transform((value) => value === 'true'),
    ANALYTICS_STATE_MACHINE_ARN: trimmedOptionalString,
    WEBSOCKET_PUBLIC_URL: trimmedOptionalString,
    WEBSOCKET_MANAGEMENT_ENDPOINT: trimmedOptionalString,
    TRACKING_BASE_URL: trimmedOptionalString,
    GEOCODING_PROVIDER: z.string().trim().min(1).default('disabled'),
    GEOCODING_BASE_URL: z.string().trim().url().default('https://nominatim.openstreetmap.org'),
    GEOCODING_USER_AGENT: z.string().trim().min(1).default('CloudFleet/0.1'),
    GEOCODING_MIN_INTERVAL_MS: numberFromEnvironment(1000, 0, 60_000),
    ROUTING_PROVIDER: z.string().trim().min(1).default('straight-line'),
    ROUTING_BASE_URL: z.string().trim().url().default('https://router.project-osrm.org'),
    ROUTING_ORIGIN_LAT: numberFromEnvironment(10.7769, -90, 90),
    ROUTING_ORIGIN_LNG: numberFromEnvironment(106.7009, -180, 180),
    VAPID_PUBLIC_KEY: trimmedOptionalString,
    VAPID_PRIVATE_KEY: trimmedOptionalString,
    VAPID_SUBJECT: z.string().trim().min(1).default('mailto:ops@cloudfleet.local'),
    OBSERVABILITY_ENVIRONMENT: trimmedOptionalString,
    METRICS_SERVICE_NAME: z.string().trim().min(1).default('cloudfleet-api'),
    METRICS_NAMESPACE: z.string().trim().min(1).default('CloudFleet/Observability'),
  })
  .superRefine((environment, context) => {
    const origins = environment.CORS_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (environment.NODE_ENV === 'production' && origins.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ALLOWED_ORIGINS'],
        message: 'CORS_ALLOWED_ORIGINS is required in production',
      });
    }

    if (
      environment.AUTH_MODE === 'cognito' &&
      (!environment.COGNITO_USER_POOL_ID || !environment.COGNITO_CLIENT_ID)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_MODE'],
        message: 'COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required for Cognito auth',
      });
    }
  });

export interface AppConfig {
  runtime: {
    nodeEnv: 'development' | 'test' | 'production';
    port: number;
    corsAllowedOrigins: string[];
  };
  auth: {
    mode: 'disabled' | 'cognito';
    userPoolId: string | null;
    clientId: string | null;
  };
  aws: { region: string };
  dynamodb: { tableName: string; endpoint: string | null };
  s3: {
    deliveryProofBucket: string;
    analyticsBucket: string | null;
    endpoint: string | null;
    publicEndpoint: string | null;
    forcePathStyle: boolean;
  };
  analytics: { stateMachineArn: string | null };
  realtime: { publicUrl: string | null; managementEndpoint: string | null };
  tracking: { baseUrl: string | null };
  geocoding: { provider: string; baseUrl: string; userAgent: string; minIntervalMs: number };
  routing: {
    provider: string;
    baseUrl: string;
    origin: { lat: number; lng: number };
  };
  push: { publicKey: string | null; privateKey: string | null; subject: string };
  observability: { environment: string; serviceName: string; namespace: string };
}

const nullable = (value: string | undefined): string | null => value ?? null;
const nullableSecret = (value: string | undefined): string | null =>
  value && value !== 'REPLACE_ME' ? value : null;

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): AppConfig => {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid application configuration: ${details}`);
  }

  const environment = result.data;
  return {
    runtime: {
      nodeEnv: environment.NODE_ENV,
      port: environment.PORT,
      corsAllowedOrigins: environment.CORS_ALLOWED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    },
    auth: {
      mode: environment.AUTH_MODE,
      userPoolId: nullable(environment.COGNITO_USER_POOL_ID),
      clientId: nullable(environment.COGNITO_CLIENT_ID),
    },
    aws: { region: environment.AWS_REGION },
    dynamodb: {
      tableName: environment.DYNAMODB_TABLE_NAME,
      endpoint: nullable(environment.DYNAMODB_ENDPOINT),
    },
    s3: {
      deliveryProofBucket: environment.S3_DELIVERY_PROOF_BUCKET,
      analyticsBucket: nullable(environment.S3_ANALYTICS_BUCKET),
      endpoint: nullable(environment.S3_ENDPOINT),
      publicEndpoint: nullable(environment.S3_PUBLIC_ENDPOINT),
      forcePathStyle: environment.S3_FORCE_PATH_STYLE,
    },
    analytics: { stateMachineArn: nullable(environment.ANALYTICS_STATE_MACHINE_ARN) },
    realtime: {
      publicUrl: nullable(environment.WEBSOCKET_PUBLIC_URL),
      managementEndpoint: nullable(environment.WEBSOCKET_MANAGEMENT_ENDPOINT),
    },
    tracking: { baseUrl: nullable(environment.TRACKING_BASE_URL) },
    geocoding: {
      provider: environment.GEOCODING_PROVIDER,
      baseUrl: environment.GEOCODING_BASE_URL,
      userAgent: environment.GEOCODING_USER_AGENT,
      minIntervalMs: environment.GEOCODING_MIN_INTERVAL_MS,
    },
    routing: {
      provider: environment.ROUTING_PROVIDER,
      baseUrl: environment.ROUTING_BASE_URL,
      origin: { lat: environment.ROUTING_ORIGIN_LAT, lng: environment.ROUTING_ORIGIN_LNG },
    },
    push: {
      publicKey: nullableSecret(environment.VAPID_PUBLIC_KEY),
      privateKey: nullableSecret(environment.VAPID_PRIVATE_KEY),
      subject: environment.VAPID_SUBJECT,
    },
    observability: {
      environment: environment.OBSERVABILITY_ENVIRONMENT ?? environment.NODE_ENV,
      serviceName: environment.METRICS_SERVICE_NAME,
      namespace: environment.METRICS_NAMESPACE,
    },
  };
};
