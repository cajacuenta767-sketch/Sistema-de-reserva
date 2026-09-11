import type { NextFunction, Request, Response } from 'express';
import type { TokenService } from '../../../application/ports/index.js';
import type { Role } from '../../../domain/entities/User.js';
import { AppError } from '../../../shared/AppError.js';

export interface AuthUser {
  id: string;
  role: Role;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const authenticate = (tokens: TokenService) => (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const p = tokens.verifyAccess(header.slice(7));
    req.user = { id: p.sub, role: p.role, email: p.email };
  } catch {
    return next(AppError.unauthorized('Token inválido o expirado'));
  }
  next();
};

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(AppError.unauthorized('Debes iniciar sesión'));
  next();
};

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(AppError.unauthorized('Debes iniciar sesión'));
  if (!roles.includes(req.user.role)) return next(AppError.forbidden());
  next();
};
