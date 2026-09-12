import { RemovalPolicy, type App } from 'aws-cdk-lib';

export const DEPLOYMENT_STAGES = ['dev', 'test', 'staging', 'prod'] as const;
export type DeploymentStage = (typeof DEPLOYMENT_STAGES)[number];

export interface RoutingDeploymentConfig {
  provider: 'straight-line' | 'osrm';
  baseUrl: string;
  originLatitude: string;
  originLongitude: string;
}

export interface DeploymentConfig {
  projectName: string;
  stage: DeploymentStage;
  prefix: string;
  isProduction: boolean;
  removalPolicy: RemovalPolicy;
  corsAllowedOrigins: string[];
  routing: RoutingDeploymentConfig;
}

export interface DeploymentConfigInput {
  projectName?: string;
  stage?: string;
  corsAllowedOrigins?: string;
  routingProvider?: string;
  routingBaseUrl?: string;
  routingOriginLatitude?: string;
  routingOriginLongitude?: string;
}

const requiredText = (value: string | undefined, fallback: string, name: string): string => {
  const result = (value ?? fallback).trim();
  if (!result) throw new Error(`${name} must not be empty`);
  return result;
};

export const parseDeploymentStage = (value: string | undefined): DeploymentStage => {
  const stage = requiredText(value, 'dev', 'stage');
  if (!DEPLOYMENT_STAGES.includes(stage as DeploymentStage)) {
    throw new Error(`stage must be one of: ${DEPLOYMENT_STAGES.join(', ')}`);
  }
  return stage as DeploymentStage;
};

const parseCorsOrigins = (value: string | undefined): string[] => {
  const origins = (value ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins.length === 0) throw new Error('At least one corsAllowedOrigins value is required');
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error(`Invalid CORS origin: ${origin}`);
    }
  }
  return [...new Set(origins)];
};

export const createDeploymentConfig = (input: DeploymentConfigInput): DeploymentConfig => {
  const projectName = requiredText(input.projectName, 'cloudfleet', 'projectName');
  const stage = parseDeploymentStage(input.stage);
  const provider = requiredText(input.routingProvider, 'straight-line', 'routingProvider');
  if (provider !== 'straight-line' && provider !== 'osrm') {
    throw new Error('routingProvider must be straight-line or osrm');
  }
  const isProduction = stage === 'prod';
  return {
    projectName,
    stage,
    prefix: `${projectName}-${stage}`,
    isProduction,
    removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    corsAllowedOrigins: parseCorsOrigins(input.corsAllowedOrigins),
    routing: {
      provider,
      baseUrl: requiredText(
        input.routingBaseUrl,
        'https://router.project-osrm.org',
        'routingBaseUrl',
      ),
      originLatitude: requiredText(input.routingOriginLatitude, '10.7769', 'routingOriginLatitude'),
      originLongitude: requiredText(
        input.routingOriginLongitude,
        '106.7009',
        'routingOriginLongitude',
      ),
    },
  };
};

const contextText = (app: App, name: string): string | undefined => {
  const value = app.node.tryGetContext(name) as unknown;
  return typeof value === 'string' ? value : undefined;
};

export const deploymentConfigFromApp = (
  app: App,
  environment: NodeJS.ProcessEnv = process.env,
): DeploymentConfig =>
  createDeploymentConfig({
    projectName: contextText(app, 'projectName'),
    stage: contextText(app, 'stage'),
    corsAllowedOrigins: contextText(app, 'corsAllowedOrigins'),
    routingProvider: contextText(app, 'routingProvider') ?? environment.CLOUDFLEET_ROUTING_PROVIDER,
    routingBaseUrl: contextText(app, 'routingBaseUrl') ?? environment.CLOUDFLEET_ROUTING_BASE_URL,
    routingOriginLatitude:
      contextText(app, 'routingOriginLatitude') ?? environment.CLOUDFLEET_ROUTING_ORIGIN_LAT,
    routingOriginLongitude:
      contextText(app, 'routingOriginLongitude') ?? environment.CLOUDFLEET_ROUTING_ORIGIN_LNG,
  });
