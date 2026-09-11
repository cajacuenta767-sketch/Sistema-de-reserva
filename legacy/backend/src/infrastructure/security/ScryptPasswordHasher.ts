import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordHasher } from '../../application/ports/index.js';

const scryptAsync = promisify(scrypt);
const KEYLEN = 64;

/** Hash de contraseñas con scrypt (node:crypto), sin dependencias nativas. */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plain: string) {
    const salt = randomBytes(16).toString('hex');
    const derived = (await scryptAsync(plain, salt, KEYLEN)) as Buffer;
    return `scrypt$${salt}$${derived.toString('hex')}`;
  }
  async verify(plain: string, hash: string) {
    const [algo, salt, hex] = hash.split('$');
    if (algo !== 'scrypt' || !salt || !hex) return false;
    const derived = (await scryptAsync(plain, salt, KEYLEN)) as Buffer;
    const stored = Buffer.from(hex, 'hex');
    return stored.length === derived.length && timingSafeEqual(stored, derived);
  }
}
