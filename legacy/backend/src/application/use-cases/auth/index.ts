import { AppError } from '../../../shared/AppError.js';
import type { Clock } from '../../../shared/Clock.js';
import { newId } from '../../../shared/id.js';
import { toPublicUser, type PublicUser, type Role, type User } from '../../../domain/entities/User.js';
import type { PasswordHasher, TokenService, UserRepository } from '../../ports/index.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role?: Role;
}

export class AuthUseCases {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly clock: Clock,
  ) {}

  private issue(user: User): AuthTokens {
    const payload = { sub: user.id, role: user.role, email: user.email };
    return { accessToken: this.tokens.signAccess(payload), refreshToken: this.tokens.signRefresh(payload) };
  }

  async register(input: RegisterInput): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findByEmail(email)) throw AppError.conflict('Ya existe una cuenta con este correo');
    const now = this.clock.now().toISOString();
    const user: User = {
      id: newId(),
      email,
      passwordHash: await this.hasher.hash(input.password),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      phone: input.phone?.trim() || null,
      role: input.role ?? 'CLIENT',
      address: null,
      city: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.users.save(user);
    return { user: toPublicUser(user), tokens: this.issue(user) };
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    if (!user || !(await this.hasher.verify(password, user.passwordHash))) throw AppError.unauthorized();
    return { user: toPublicUser(user), tokens: this.issue(user) };
  }

  async refresh(refreshToken: string) {
    let payload;
    try {
      payload = this.tokens.verifyRefresh(refreshToken);
    } catch {
      throw AppError.unauthorized('Token de refresco inválido');
    }
    const user = await this.users.findById(payload.sub);
    if (!user) throw AppError.unauthorized('Usuario no existe');
    return { user: toPublicUser(user), tokens: this.issue(user) };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound('Usuario');
    return toPublicUser(user);
  }

  async updateProfile(
    userId: string,
    patch: Partial<Pick<User, 'firstName' | 'lastName' | 'phone' | 'address' | 'city'>>,
  ): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound('Usuario');
    const updated: User = { ...user, ...patch, updatedAt: this.clock.now().toISOString() };
    await this.users.update(updated);
    return toPublicUser(updated);
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound('Usuario');
    if (!(await this.hasher.verify(current, user.passwordHash))) throw AppError.unauthorized('Contraseña actual incorrecta');
    await this.users.update({ ...user, passwordHash: await this.hasher.hash(next), updatedAt: this.clock.now().toISOString() });
  }
}
