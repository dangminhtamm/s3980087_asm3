export const USER_ROLES = ['ADMIN', 'DRIVER'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export interface AuthenticatedUser {
  subject: string;
  username: string;
  roles: UserRole[];
}
