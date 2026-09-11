import type { RequestContext } from '../authz/RequestContext.js';
import type { Tx } from '../db/unitOfWork.js';

/**
 * Registro de importadores.
 *
 * Importar un CSV es el mismo problema para clientes, productos, proveedores o
 * asientos: leer el fichero, dejar que alguien empareje columnas con campos,
 * validar fila a fila y reportar los errores con su número de línea. Lo único
 * que cambia es qué se crea con cada fila.
 *
 * Por eso vive en la plataforma y cada módulo aporta solo esa parte: `crm` sabe
 * crear un cliente y nada más; no repite el CSV, ni el mapeo, ni el informe de
 * errores.
 *
 * **Cada fila pasa por el MISMO caso de uso que la aplicación real.** Un camino
 * rápido de inserción masiva se saltaría la validación, la auditoría y los
 * eventos, y produciría datos que la aplicación nunca habría aceptado: es
 * exactamente así como una importación mete 500 clientes con el NIT mal.
 */

/** Campo de la entidad que se puede rellenar desde una columna del fichero. */
export interface ImportField {
  /** Nombre del campo en el caso de uso: `displayName`, `taxId`, `salePrice`. */
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'boolean' | 'date';
  /** Ayuda para el usuario: formato esperado, valores admitidos. */
  hint?: string;
  /**
   * Cabeceras que se reconocen solas, en minúsculas y sin tildes.
   *
   * Con esto, un fichero con la columna "Razón social" se empareja sin que nadie
   * toque nada. Es la diferencia entre importar en un minuto o en veinte.
   */
  aliases?: readonly string[];
}

export interface ImportDefinition {
  entityType: string;
  label: string;
  /** Permiso necesario para importar: el mismo que para crear a mano. */
  permission: string;
  fields: readonly ImportField[];
  /**
   * Crea UNA entidad a partir de una fila ya mapeada.
   *
   * Devuelve el id de lo creado y una etiqueta para el informe: sin ella, una
   * fila correcta queda como "OK" sin decir qué se creó.
   */
  createOne(
    tx: Tx,
    ctx: RequestContext,
    row: Record<string, string>,
  ): Promise<{ id: string; label: string }>;
}

export class ImportRegistry {
  private readonly definitions = new Map<string, ImportDefinition>();

  register(definitions: readonly ImportDefinition[]): void {
    for (const definition of definitions) {
      if (this.definitions.has(definition.entityType)) {
        throw new Error(`Ya hay un importador registrado para "${definition.entityType}"`);
      }
      this.definitions.set(definition.entityType, definition);
    }
  }

  get(entityType: string): ImportDefinition | null {
    return this.definitions.get(entityType) ?? null;
  }

  /** Lo que este usuario puede importar, según sus permisos. */
  availableFor(ctx: RequestContext): ImportDefinition[] {
    return [...this.definitions.values()].filter((d) => ctx.permissions.can(d.permission));
  }

  get size(): number {
    return this.definitions.size;
  }
}
