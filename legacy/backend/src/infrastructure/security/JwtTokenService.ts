import jwt, { type SignOptions } from 'jsonwebtoken';
import type { TokenPayload, TokenService } from '../../application/ports/index.js';

export interface JwtConfig {
  accessSecret: string;
  refreshSecret: string;
  accessTtl: string;
  refreshTtl: string;
}

export class JwtTokenService implements TokenService {
  constructor(private readonly cfg: JwtConfig) {}
  signAccess(p: TokenPayload) {
    return jwt.sign(p, this.cfg.accessSecret, { expiresIn: this.cfg.accessTtl as SignOptions['expiresIn'] });
  }
  signRefresh(p: TokenPayload) {
    return jwt.sign({ ...p, typ: 'refresh' }, this.cfg.refreshSecret, { expiresIn: this.cfg.refreshTtl as SignOptions['expiresIn'] });
  }
  verifyAccess(token: string) {
    const d = jwt.verify(token, this.cfg.accessSecret) as TokenPayload;
    return { sub: d.sub, role: d.role, email: d.email };
  }
  verifyRefresh(token: string) {
    const d = jwt.verify(token, this.cfg.refreshSecret) as TokenPayload & { typ?: string };
    if (d.typ !== 'refresh') throw new Error('not a refresh token');
    return { sub: d.sub, role: d.role, email: d.email };
  }
}
