import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from '@erp/core';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  /** Organización activa. Puede faltar si el usuario aún no ha elegido una. */
  org?: string | undefined;
  mem?: string | undefined;
  sa?: boolean | undefined;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  /** Identificador único de este token de refresco (su `jti`). */
  refreshTokenId: string;
}

export interface TokenService {
  issue(payload: AccessTokenPayload): TokenPair;
  verifyAccess(token: string): AccessTokenPayload;
  verifyRefresh(token: string): { sub: string; jti: string };
  hashRefresh(token: string): string;
  refreshExpiresAt(from: Date): Date;
}

const DURATION_MS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export const durationToMs = (v: string): number => {
  const match = /^(\d+)([smhd])$/.exec(v);
  if (!match?.[1] || !match[2]) throw new Error(`Duración inválida: ${v}`);
  return Number(match[1]) * (DURATION_MS[match[2]] ?? 0);
};

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: string;
  refreshTtl: string;
}

export class JwtTokenService implements TokenService {
  constructor(private readonly config: JwtConfig) {}

  issue(payload: AccessTokenPayload): TokenPair {
    const accessToken = jwt.sign(payload, this.config.accessSecret, {
      expiresIn: this.config.accessTtl as jwt.SignOptions['expiresIn'],
    });
    // El refresh solo lleva el sujeto: nunca la organización ni los permisos.
    // Así cambiar de organización o de rol no exige renovar la sesión entera.
    //
    // El `jti` no es decorativo: sin él, dos sesiones abiertas en el MISMO
    // segundo producen exactamente el mismo JWT (el payload y el `iat` en
    // segundos coinciden), su hash colisiona en la tabla de sesiones y el
    // segundo inicio de sesión falla. Además ata cada token a su fila, que es
    // lo que permite detectar el reuso de uno ya rotado.
    const refreshTokenId = randomUUID();
    const refreshToken = jwt.sign(
      { sub: payload.sub, typ: 'refresh', jti: refreshTokenId },
      this.config.refreshSecret,
      { expiresIn: this.config.refreshTtl as jwt.SignOptions['expiresIn'] },
    );
    return {
      accessToken,
      refreshToken,
      refreshTokenId,
      expiresIn: Math.floor(durationToMs(this.config.accessTtl) / 1000),
    };
  }

  verifyAccess(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, this.config.accessSecret);
      if (typeof decoded === 'string' || !decoded.sub) throw new Error('payload inválido');
      return decoded as AccessTokenPayload;
    } catch (err) {
      throw err instanceof jwt.TokenExpiredError
        ? AppError.unauthorized('La sesión ha expirado')
        : AppError.unauthorized('Token inválido');
    }
  }

  verifyRefresh(token: string): { sub: string; jti: string } {
    try {
      const decoded = jwt.verify(token, this.config.refreshSecret);
      if (typeof decoded === 'string' || decoded.typ !== 'refresh' || !decoded.sub || !decoded.jti) {
        throw new Error('no es un token de refresco');
      }
      return { sub: String(decoded.sub), jti: String(decoded.jti) };
    } catch {
      throw AppError.unauthorized('Token de refresco inválido');
    }
  }

  /** En base de datos solo se guarda el hash: un volcado de la tabla no da sesiones. */
  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  refreshExpiresAt(from: Date): Date {
    return new Date(from.getTime() + durationToMs(this.config.refreshTtl));
  }
}
