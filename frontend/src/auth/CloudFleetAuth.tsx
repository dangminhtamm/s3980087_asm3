import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { UserManager, type User } from 'oidc-client-ts';

import { runtimeEnv, type CloudFleetRuntimeVariable } from '../config/runtime';
import { clearOfflineData } from '../services/offline-store';

export type UserRole = 'ADMIN' | 'DRIVER';

export interface CloudFleetUser {
  subject: string;
  username: string;
  displayName: string;
  email?: string;
  roles: UserRole[];
}

interface AuthContextValue {
  isLoading: boolean;
  isEnabled: boolean;
  user: CloudFleetUser | null;
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
  completeLogin: () => Promise<CloudFleetUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const authMode = runtimeEnv('VITE_AUTH_MODE')?.toLowerCase() || 'disabled';
const isCognitoEnabled = authMode === 'cognito';
let cognitoLogoutUrl: string | null = null;

const requiredEnv = (name: CloudFleetRuntimeVariable): string => {
  const value = runtimeEnv(name);
  if (!value) throw new Error(`Missing frontend environment variable: ${name}`);
  return value;
};

const createUserManager = (): UserManager | null => {
  if (!isCognitoEnabled) return null;

  const region = requiredEnv('VITE_COGNITO_REGION');
  const userPoolId = requiredEnv('VITE_COGNITO_USER_POOL_ID');
  const clientId = requiredEnv('VITE_COGNITO_CLIENT_ID');
  const domain = requiredEnv('VITE_COGNITO_DOMAIN').replace(/\/$/, '');
  const authority = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const logoutRedirectUri = window.location.origin;
  cognitoLogoutUrl = `${domain}/logout?client_id=${encodeURIComponent(clientId)}&logout_uri=${encodeURIComponent(logoutRedirectUri)}`;

  return new UserManager({
    authority,
    client_id: clientId,
    redirect_uri:
      runtimeEnv('VITE_COGNITO_REDIRECT_URI') ||
      `${window.location.origin}/auth/callback`,
    post_logout_redirect_uri: logoutRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    automaticSilentRenew: false,
    metadata: {
      issuer: authority,
      authorization_endpoint: `${domain}/oauth2/authorize`,
      token_endpoint: `${domain}/oauth2/token`,
      userinfo_endpoint: `${domain}/oauth2/userInfo`,
      end_session_endpoint: `${domain}/logout`,
      jwks_uri: `${authority}/.well-known/jwks.json`,
    },
  });
};

const userManager = createUserManager();

const isRole = (value: unknown): value is UserRole =>
  value === 'ADMIN' || value === 'DRIVER';

const toCloudFleetUser = (oidcUser: User): CloudFleetUser => {
  const groups = oidcUser.profile['cognito:groups'];
  const roles = Array.isArray(groups) ? groups.filter(isRole) : [];
  const cognitoUsername = oidcUser.profile['cognito:username'];
  const preferredUsername = oidcUser.profile.preferred_username;

  return {
    subject: oidcUser.profile.sub,
    username:
      (typeof cognitoUsername === 'string' && cognitoUsername) ||
      (typeof preferredUsername === 'string' && preferredUsername) ||
      oidcUser.profile.sub,
    displayName:
      (typeof oidcUser.profile.name === 'string' && oidcUser.profile.name) ||
      (typeof oidcUser.profile.email === 'string' && oidcUser.profile.email) ||
      oidcUser.profile.sub,
    email:
      typeof oidcUser.profile.email === 'string' ? oidcUser.profile.email : undefined,
    roles,
  };
};

/** Used by Axios without coupling the HTTP layer to React hooks. */
export const getAccessToken = async (): Promise<string | null> => {
  if (!userManager) return null;
  const user = await userManager.getUser();
  return user && !user.expired ? user.access_token : null;
};

export const CloudFleetAuthProvider = ({ children }: { children: ReactNode }) => {
  const [isLoading, setIsLoading] = useState(isCognitoEnabled);
  const [user, setUser] = useState<CloudFleetUser | null>(
    isCognitoEnabled
      ? null
      : {
          subject: 'local-development',
          username: runtimeEnv('VITE_DRIVER_ID') || 'DRV-018',
          displayName: 'Local CloudFleet User',
          email: 'local@cloudfleet.dev',
          roles: ['ADMIN', 'DRIVER'],
        },
  );

  useEffect(() => {
    if (!userManager) return;

    let active = true;
    userManager
      .getUser()
      .then((storedUser) => {
        if (active && storedUser && !storedUser.expired) {
          setUser(toCloudFleetUser(storedUser));
        }
      })
      .finally(() => active && setIsLoading(false));

    const onLoaded = (loadedUser: User) => setUser(toCloudFleetUser(loadedUser));
    const onUnloaded = () => setUser(null);
    userManager.events.addUserLoaded(onLoaded);
    userManager.events.addUserUnloaded(onUnloaded);

    return () => {
      active = false;
      userManager.events.removeUserLoaded(onLoaded);
      userManager.events.removeUserUnloaded(onUnloaded);
    };
  }, []);

  const login = useCallback(async (returnTo = '/') => {
    if (!userManager) return;
    await userManager.signinRedirect({ state: { returnTo } });
  }, []);

  const logout = useCallback(async () => {
    if (!userManager) return;
    await clearOfflineData();
    await userManager.removeUser();
    if (cognitoLogoutUrl) window.location.assign(cognitoLogoutUrl);
  }, []);

  const completeLogin = useCallback(async (): Promise<CloudFleetUser> => {
    if (!userManager) {
      throw new Error('Cognito authentication is disabled');
    }
    const oidcUser = await userManager.signinRedirectCallback();
    const authenticatedUser = toCloudFleetUser(oidcUser);
    setUser(authenticatedUser);
    return authenticatedUser;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      isEnabled: isCognitoEnabled,
      user,
      login,
      logout,
      completeLogin,
    }),
    [completeLogin, isLoading, login, logout, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useCloudFleetAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useCloudFleetAuth must be used inside its provider');
  return context;
};
