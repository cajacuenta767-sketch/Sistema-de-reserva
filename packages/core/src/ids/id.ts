/** UUID v4. Disponible tanto en Node 22 como en navegadores modernos. */
export const newId = (): string => globalThis.crypto.randomUUID();

const READABLE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I, O, 0, 1

/**
 * Código legible por humanos con prefijo, ej. `FV-7K3Q9P`.
 * Se usa para códigos de seguimiento que el cliente dicta por teléfono.
 */
export const readableCode = (prefix: string, length = 6): string => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += READABLE_ALPHABET[b % READABLE_ALPHABET.length];
  return `${prefix}-${out}`;
};

/** Token opaco en base64url, para refresh tokens, claves de API e invitaciones. */
export const secureToken = (bytes = 32): string => {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
