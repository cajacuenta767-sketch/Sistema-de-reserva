import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `tsc` solo compila TypeScript, así que los ficheros .sql de las migraciones no
 * llegan a `dist` por sí solos. Sin esto, la API compilada arranca y falla al
 * migrar en producción, que es el peor momento posible para descubrirlo.
 */
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(root, 'src/platform/db/migrations');
const to = path.join(root, 'dist/platform/db/migrations');

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
console.log(`Migraciones copiadas a ${path.relative(root, to)}`);
