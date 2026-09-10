import type { RequestHandler } from 'express';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

import {
  USER_ROLES,
  type AuthenticatedUser,
  type UserRole,
} from '../domain/entities/auth.js';
import { AppError } from '../errors/app-error.js';

const authMode = process.env.AUTH_MODE?.trim().toLowerCase() || 'disabled';

const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && USER_ROLES.some((role) => role === value);

let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

const getVerifier = (): ReturnType<typeof CognitoJwtVerifier.create> => {
  if (verifier) return verifier;

  const userPoolId = process.env.COGNITO_USER_POOL_ID?.trim();
  const clientId = process.env.COGNITO_CLIENT_ID?.trim();

  if (!userPoolId || !clientId) {
    throw new Error(
      'COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required when AUTH_MODE=cognito',
    );
  }

  verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId,
  });

  return verifier;
};

const parseBearerToken = (authorization: string | undefined): string => {
  const [scheme, token, ...extra] = authorization?.trim().split(/\s+/) ?? [];

  if (scheme !== 'Bearer' || !token || extra.length > 0) {
    throw new AppError(
      401,
      'A valid Bearer access token is required',
      'AUTHENTICATION_REQUIRED',
    );
  }

  return token;
};

/**
 * Verifies Cognito access tokens inside ECS as defense in depth. API Gateway
 * performs the first verification; local/direct requests are protected here.
 */
export const authenticateRequest: RequestHandler = async (
  request,
  _response,
  next,
) => {
  if (authMode === 'disabled') {
    request.authenticatedUser = {
      subject: 'local-development',
      username: 'local@cloudfleet.dev',
      roles: ['ADMIN', 'DRIVER'],
    };
    next();
    return;
  }

  if (authMode !== 'cognito') {
    next(new Error(`Unsupported AUTH_MODE: ${authMode}`));
    return;
  }

  try {
    const token = parseBearerToken(request.header('authorization'));
    const payload = await getVerifier().verify(token);
    const rawGroups = payload['cognito:groups'];
    const roles = Array.isArray(rawGroups)
      ? rawGroups.filter(isUserRole)
      : [];

    request.authenticatedUser = {
      subject: payload.sub,
      username:
        typeof payload.username === 'string' ? payload.username : payload.sub,
      roles,
    };
    next();
  } catch (error: unknown) {
    if (error instanceof AppError) {
      next(error);
      return;
    }

    next(new AppError(401, 'Access token is invalid or expired', 'INVALID_TOKEN'));
  }
};

export const requireRole = (...allowedRoles: UserRole[]): RequestHandler =>
  (request, _response, next) => {
    const user = request.authenticatedUser;

    if (!user) {
      next(
        new AppError(401, 'Authentication is required', 'AUTHENTICATION_REQUIRED'),
      );
      return;
    }

    if (!user.roles.some((role) => allowedRoles.includes(role))) {
      next(
        new AppError(
          403,
          'You do not have permission to perform this action',
          'INSUFFICIENT_ROLE',
        ),
      );
      return;
    }

    next();
  };
