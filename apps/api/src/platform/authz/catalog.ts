import type { PermissionDef } from '@erp/contracts';
import type { Tx } from '../db/unitOfWork.js';

/**
 * Catálogo global de permisos.
 *
 * Se llena desde los `module.ts` de cada módulo, nunca a mano. Al arrancar se
 * sincroniza con la tabla `permissions`, y un test comprueba en ambos sentidos
 * que no exista un permiso que nadie verifica ni una verificación de un permiso
 * que no existe: las dos formas de que un sistema de permisos mienta.
 */
export class PermissionCatalog {
  private readonly byKey = new Map<string, PermissionDef>();

  register(defs: readonly PermissionDef[], moduleId: string): void {
    for (const def of defs) {
      const existing = this.byKey.get(def.key);
      if (existing) {
        throw new Error(
          `El permiso "${def.key}" está declarado dos veces (módulos "${existing.module}" y "${moduleId}")`,
        );
      }
      this.byKey.set(def.key, def);
    }
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  get(key: string): PermissionDef | undefined {
    return this.byKey.get(key);
  }

  all(): PermissionDef[] {
    return [...this.byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  byModule(): Map<string, PermissionDef[]> {
    const grouped = new Map<string, PermissionDef[]>();
    for (const def of this.all()) {
      const list = grouped.get(def.module) ?? [];
      list.push(def);
      grouped.set(def.module, list);
    }
    return grouped;
  }

  get size(): number {
    return this.byKey.size;
  }

  /**
   * Vuelca el catálogo en la base de datos. Los permisos que ya no declara
   * ningún módulo se eliminan, y con ellos las concesiones que los referencian:
   * un permiso huérfano en un rol es una mentira sobre lo que alguien puede hacer.
   */
  async sync(tx: Tx): Promise<{ inserted: number; removed: number }> {
    const defs = this.all();
    if (defs.length === 0) return { inserted: 0, removed: 0 };

    const values: unknown[] = [];
    const rows = defs.map((d, i) => {
      const b = i * 7;
      values.push(d.key, d.module, d.resource, d.action, d.label, d.description ?? null, [...d.scopes]);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}::text[])`;
    });

    await tx.client.query(
      `INSERT INTO permissions (key, module, resource, action, label, description, scopes)
       VALUES ${rows.join(', ')}
       ON CONFLICT (key) DO UPDATE SET
         module = EXCLUDED.module, resource = EXCLUDED.resource, action = EXCLUDED.action,
         label = EXCLUDED.label, description = EXCLUDED.description,
         scopes = EXCLUDED.scopes, synced_at = now()`,
      values,
    );

    const removed = await tx.client.query('DELETE FROM permissions WHERE key <> ALL($1::text[])', [
      defs.map((d) => d.key),
    ]);

    return { inserted: defs.length, removed: removed.rowCount ?? 0 };
  }
}
