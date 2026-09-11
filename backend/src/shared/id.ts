import { randomUUID, randomBytes } from 'node:crypto';

export const newId = (): string => randomUUID();

/** Código legible para el cliente, ej. RF-7K3Q9P */
export const confirmationCode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `RF-${out}`;
};
