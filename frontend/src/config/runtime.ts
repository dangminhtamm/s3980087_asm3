export type CloudFleetRuntimeVariable =
  | 'VITE_API_BASE_URL'
  | 'VITE_AUTH_MODE'
  | 'VITE_COGNITO_REGION'
  | 'VITE_COGNITO_USER_POOL_ID'
  | 'VITE_COGNITO_CLIENT_ID'
  | 'VITE_COGNITO_DOMAIN'
  | 'VITE_COGNITO_REDIRECT_URI'
  | 'VITE_DRIVER_ID'
  | 'VITE_ENABLE_MOCK_FALLBACK';

// Keep this allowlist explicit. Dynamic access to import.meta.env can make Vite
// serialize unrelated VITE_* values from a developer's local environment.
const buildEnvironment: Record<
  CloudFleetRuntimeVariable,
  string | undefined
> = {
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_AUTH_MODE: import.meta.env.VITE_AUTH_MODE,
  VITE_COGNITO_REGION: import.meta.env.VITE_COGNITO_REGION,
  VITE_COGNITO_USER_POOL_ID: import.meta.env.VITE_COGNITO_USER_POOL_ID,
  VITE_COGNITO_CLIENT_ID: import.meta.env.VITE_COGNITO_CLIENT_ID,
  VITE_COGNITO_DOMAIN: import.meta.env.VITE_COGNITO_DOMAIN,
  VITE_COGNITO_REDIRECT_URI: import.meta.env.VITE_COGNITO_REDIRECT_URI,
  VITE_DRIVER_ID: import.meta.env.VITE_DRIVER_ID,
  VITE_ENABLE_MOCK_FALLBACK: import.meta.env.VITE_ENABLE_MOCK_FALLBACK,
};

/**
 * Reads deployment-time values first, then falls back to Vite build values.
 * AWS writes runtime-config.js after the static bundle is uploaded, allowing a
 * single frontend build to receive CloudFormation-generated endpoints safely.
 */
export const runtimeEnv = (name: CloudFleetRuntimeVariable): string | undefined => {
  const runtimeValue = window.__CLOUDFLEET_CONFIG__?.[name];
  const buildValue = buildEnvironment[name];
  const value = typeof runtimeValue === 'string' ? runtimeValue : buildValue;

  return value?.trim() || undefined;
};
