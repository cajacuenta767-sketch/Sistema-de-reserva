import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
}

/**
 * scrypt de la librería estándar de Node: sin dependencias nativas que compilar
 * y resistente a hardware especializado, que es lo que hace falta aquí.
 * Formato: `scrypt$<salt hex>$<clave hex>`.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
    return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const [algorithm, saltHex, keyHex] = stored.split('$');
    if (algorithm !== 'scrypt' || !saltHex || !keyHex) return false;

    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const actual = (await scryptAsync(plain, salt, expected.length)) as Buffer;
    // Comparación en tiempo constante: una comparación normal filtra información
    // sobre el hash a través del tiempo que tarda en fallar.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
