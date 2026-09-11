export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DELETED';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarFileId: string | null;
  locale: string;
  status: UserStatus;
  totpSecret: string | null;
  totpEnabled: boolean;
  lastLoginAt: Date | null;
  isSuperAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  defaultBranchId: string | null;
  jobTitle: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  isOwner: boolean;
}

export interface Role {
  id: string;
  organizationId: string;
  code: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  parentTeamId: string | null;
  leadMembershipId: string | null;
}

export const fullName = (u: Pick<User, 'firstName' | 'lastName'>): string =>
  `${u.firstName} ${u.lastName}`.trim();

/** Proyección segura: nunca deja escapar el hash ni el secreto TOTP. */
export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  locale: string;
  isSuperAdmin: boolean;
}

export const toPublicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  fullName: fullName(u),
  phone: u.phone,
  avatarUrl: u.avatarFileId ? `/api/v1/files/${u.avatarFileId}` : null,
  locale: u.locale,
  isSuperAdmin: u.isSuperAdmin,
});

export const canLogin = (u: User): boolean => u.status === 'ACTIVE';
