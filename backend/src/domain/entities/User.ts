export type Role = 'CLIENT' | 'STAFF' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: Role;
  address: string | null;
  city: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PublicUser = Omit<User, 'passwordHash'>;

export const toPublicUser = (u: User): PublicUser => {
  const { passwordHash: _ph, ...rest } = u;
  return rest;
};
