import type { AuthenticatedUser } from '../domain/entities/auth.js';

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUser;
      requestId: string;
    }
  }
}

export {};
