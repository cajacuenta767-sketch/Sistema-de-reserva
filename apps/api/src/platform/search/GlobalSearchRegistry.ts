import type { RequestContext } from '../authz/RequestContext.js';
import type { Tx } from '../db/unitOfWork.js';

export interface SearchHit {
  entityType: string;
  id: string;
  title: string;
  subtitle?: string;
  url: string;
  icon?: string;
}

export interface SearchProvider {
  entityType: string;
  label: string;
  /** Permiso necesario para que los resultados aparezcan. */
  permission: string;
  search(tx: Tx, ctx: RequestContext, term: string, limit: number): Promise<SearchHit[]>;
}

/**
 * Búsqueda global (⌘K). Cada módulo aporta su proveedor; el registro consulta
 * solo los que el usuario tiene permiso de ver, de modo que la búsqueda nunca
 * revela la existencia de registros a los que no tiene acceso.
 */
export class GlobalSearchRegistry {
  private readonly providers: SearchProvider[] = [];

  register(providers: readonly SearchProvider[]): void {
    this.providers.push(...providers);
  }

  async search(tx: Tx, ctx: RequestContext, term: string, limitPerType = 5): Promise<SearchHit[]> {
    const allowed = this.providers.filter((p) => ctx.permissions.can(p.permission));
    // Secuencial: todos los proveedores comparten el cliente de la transacción,
    // y una conexión ejecuta una consulta a la vez. Un módulo con la búsqueda
    // rota no puede dejar sin resultados a los demás.
    const hits: SearchHit[] = [];
    for (const provider of allowed) {
      try {
        hits.push(...(await provider.search(tx, ctx, term, limitPerType)));
      } catch {
        /* se ignora el proveedor que falla */
      }
    }
    return hits;
  }

  get size(): number {
    return this.providers.length;
  }
}
