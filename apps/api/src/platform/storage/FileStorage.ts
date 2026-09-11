import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@erp/core';

export interface StoredFile {
  storageKey: string;
  size: number;
  checksum: string;
}

export interface FileStorage {
  put(key: string, content: Buffer, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** URL temporal de descarga, o null si el adaptador sirve a través de la API. */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
}

/** Clave particionada por organización y fecha, para que un listado del bucket
 *  siga siendo navegable con cientos de miles de ficheros. */
export const storageKeyFor = (
  organizationId: string,
  filename: string,
  id: string,
  at: Date,
): string => {
  const safe = path
    .basename(filename)
    .replace(/[^\w.-]/g, '_')
    .slice(0, 120);
  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `${organizationId}/${yyyy}/${mm}/${id}-${safe}`;
};

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    // Una clave con `..` escaparía del directorio de almacenamiento.
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw AppError.validation('Ruta de fichero inválida');
    }
    return full;
  }

  async put(key: string, content: Buffer): Promise<StoredFile> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
    return {
      storageKey: key,
      size: content.byteLength,
      checksum: createHash('sha256').update(content).digest('hex'),
    };
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolve(key));
    } catch {
      throw AppError.notFound('Fichero');
    }
  }

  async delete(key: string): Promise<void> {
    await unlink(this.resolve(key)).catch(() => undefined);
  }

  async signedUrl(): Promise<string | null> {
    // En disco local los ficheros se sirven por la API, con permisos aplicados.
    return null;
  }
}
