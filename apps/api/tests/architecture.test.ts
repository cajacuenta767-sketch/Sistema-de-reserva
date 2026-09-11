import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guardia de arquitectura.
 *
 * Con 30 módulos, lo que mantiene la arquitectura viva no es la buena voluntad
 * sino una prueba que falla cuando alguien cruza una frontera. Analiza los
 * imports reales de cada fichero y comprueba cuatro reglas:
 *
 *   1. El dominio no importa aplicación ni infraestructura.
 *   2. La aplicación no importa infraestructura.
 *   3. Un módulo solo ve a otro por su API pública (`index.ts`), nunca por dentro.
 *   4. La plataforma no depende de ningún módulo concreto.
 *
 * Al final hay un test que verifica que el propio analizador detecta
 * violaciones: una regla que no sabe fallar no es una regla.
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

interface SourceFile {
  /** Ruta relativa a `src`, con separadores `/`. */
  rel: string;
  imports: string[];
}

const IMPORT_RE = /^\s*(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]/gm;
const BARE_IMPORT_RE = /^\s*import\s*['"]([^'"]+)['"]/gm;

const walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
    }),
  );
  return files.flat();
};

const loadSources = async (): Promise<SourceFile[]> => {
  const files = await walk(SRC);
  return Promise.all(
    files.map(async (full) => {
      const content = await readFile(full, 'utf8');
      const imports: string[] = [];
      for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) if (m[1]) imports.push(m[1]);
      }
      return { rel: path.relative(SRC, full).split(path.sep).join('/'), imports };
    }),
  );
};

/** Resuelve un import relativo a una ruta relativa a `src`. */
export const resolveImport = (fromRel: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null; // paquete externo o del monorepo
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  return resolved.replace(/\.js$/, '.ts');
};

interface Location {
  area: 'platform' | 'module' | 'config' | 'seed' | 'bootstrap' | 'other';
  module?: string;
  layer?: 'domain' | 'application' | 'infrastructure' | 'public';
}

export const locate = (rel: string): Location => {
  const parts = rel.split('/');
  if (parts[0] === 'platform') return { area: 'platform' };
  if (parts[0] === 'config') return { area: 'config' };
  if (parts[0] === 'seed') return { area: 'seed' };
  if (parts[0] === 'bootstrap') return { area: 'bootstrap' };
  if (parts[0] === 'modules') {
    const moduleName = parts[1];
    if (!moduleName || moduleName.endsWith('.ts')) return { area: 'other' };
    const layerName = parts[2];
    const layer =
      layerName === 'domain' || layerName === 'application' || layerName === 'infrastructure'
        ? layerName
        : 'public'; // index.ts y module.ts del módulo
    return { area: 'module', module: moduleName, layer };
  }
  return { area: 'other' };
};

export interface Violation {
  from: string;
  to: string;
  rule: string;
}

export const findViolations = (sources: readonly SourceFile[]): Violation[] => {
  const violations: Violation[] = [];

  for (const file of sources) {
    const from = locate(file.rel);

    for (const spec of file.imports) {
      const targetRel = resolveImport(file.rel, spec);
      if (!targetRel) continue;
      const to = locate(targetRel);

      // 1 y 2 · Las capas apuntan hacia dentro.
      if (from.area === 'module' && to.area === 'module' && from.module === to.module) {
        if (from.layer === 'domain' && (to.layer === 'application' || to.layer === 'infrastructure')) {
          violations.push({ from: file.rel, to: targetRel, rule: 'domain→' + to.layer });
        }
        if (from.layer === 'application' && to.layer === 'infrastructure') {
          violations.push({ from: file.rel, to: targetRel, rule: 'application→infrastructure' });
        }
      }

      // 3 · Entre módulos, solo la API pública.
      if (
        from.area === 'module' &&
        to.area === 'module' &&
        from.module !== to.module &&
        to.layer !== 'public'
      ) {
        violations.push({
          from: file.rel,
          to: targetRel,
          rule: `módulo "${from.module}" mira dentro de "${to.module}"`,
        });
      }

      // 4 · La plataforma es transversal.
      if (from.area === 'platform' && to.area === 'module') {
        violations.push({ from: file.rel, to: targetRel, rule: 'platform→module' });
      }
    }
  }

  return violations;
};

describe('arquitectura hexagonal', () => {
  it('ningún fichero cruza una frontera de capa o de módulo', async () => {
    const violations = findViolations(await loadSources());
    const report = violations.map((v) => `  ${v.from}\n    → ${v.to}  [${v.rule}]`).join('\n');
    expect(violations, `Violaciones de arquitectura:\n${report}`).toEqual([]);
  });

  // Una regla que no sabe fallar no es una regla: esto prueba el propio guardia.
  it('el analizador detecta una violación de capa', () => {
    const violations = findViolations([
      {
        rel: 'modules/invoicing/domain/Invoice.ts',
        imports: ['../infrastructure/persistence/PgInvoiceRepository.js'],
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('domain→infrastructure');
  });

  it('el analizador detecta que un módulo mira dentro de otro', () => {
    const violations = findViolations([
      {
        rel: 'modules/invoicing/application/IssueInvoice.ts',
        imports: ['../../crm/domain/Party.js'],
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toContain('mira dentro de');
  });

  it('el analizador detecta que la plataforma depende de un módulo', () => {
    const violations = findViolations([
      { rel: 'platform/http/list.ts', imports: ['../../modules/crm/domain/Party.js'] },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('platform→module');
  });

  it('permite lo que sí es legítimo', () => {
    expect(
      findViolations([
        {
          rel: 'modules/invoicing/application/IssueInvoice.ts',
          imports: ['../domain/Invoice.js', '../../../platform/db/unitOfWork.js', '../../crm/index.js'],
        },
        {
          rel: 'modules/invoicing/infrastructure/http/invoice.routes.ts',
          imports: ['../../application/IssueInvoice.js', '../../domain/Invoice.js'],
        },
      ]),
    ).toEqual([]);
  });
});
