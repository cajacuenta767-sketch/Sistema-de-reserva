/**
 * Modelo de permisos del sistema.
 *
 * Clave: `modulo:recurso:accion` — p. ej. `sales:invoice:create`.
 * El catálogo NO se escribe a mano: cada módulo declara sus permisos en su
 * `module.ts`, el registro los agrega y el arranque los sincroniza en base de
 * datos. Un test verifica en ambos sentidos que no exista un permiso que nadie
 * comprueba ni una comprobación de un permiso que no existe.
 */

/** Alcance, de menor a mayor. El orden importa: se comparan por índice. */
export const PERMISSION_SCOPES = ['OWN', 'TEAM', 'BRANCH', 'ORG'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const scopeRank = (s: PermissionScope): number => PERMISSION_SCOPES.indexOf(s);

/** Devuelve el alcance más amplio de los dos. */
export const widerScope = (a: PermissionScope, b: PermissionScope): PermissionScope =>
  scopeRank(a) >= scopeRank(b) ? a : b;

export interface PermissionDef {
  key: string;
  module: string;
  resource: string;
  action: string;
  label: string;
  description?: string;
  /** Alcances que tienen sentido para este permiso. Muchos solo admiten ORG. */
  scopes: readonly PermissionScope[];
  /** Marca permisos peligrosos, que la UI resalta al asignarlos a un rol. */
  sensitive?: boolean;
}

export const definePermission = (
  key: string,
  label: string,
  opts: { scopes?: readonly PermissionScope[]; description?: string; sensitive?: boolean } = {},
): PermissionDef => {
  const [module, resource, action] = key.split(':');
  if (!module || !resource || !action) {
    throw new Error(`Clave de permiso inválida: "${key}". Formato esperado: modulo:recurso:accion`);
  }
  const def: PermissionDef = {
    key,
    module,
    resource,
    action,
    label,
    scopes: opts.scopes ?? ['ORG'],
  };
  if (opts.description !== undefined) def.description = opts.description;
  if (opts.sensitive !== undefined) def.sensitive = opts.sensitive;
  return def;
};

/**
 * Atajo para los 5 permisos CRUD de un recurso, que es el 80 % de los casos.
 *   crudPermissions('crm', 'party', 'Clientes y proveedores')
 */
export const crudPermissions = (
  module: string,
  resource: string,
  label: string,
  scopes: readonly PermissionScope[] = ['OWN', 'TEAM', 'BRANCH', 'ORG'],
): PermissionDef[] => [
  definePermission(`${module}:${resource}:read`, `Ver ${label}`, { scopes }),
  definePermission(`${module}:${resource}:create`, `Crear ${label}`, { scopes: ['ORG'] }),
  definePermission(`${module}:${resource}:update`, `Editar ${label}`, { scopes }),
  definePermission(`${module}:${resource}:delete`, `Eliminar ${label}`, { scopes, sensitive: true }),
  definePermission(`${module}:${resource}:export`, `Exportar ${label}`, { scopes }),
];

export type PermissionEffect = 'ALLOW' | 'DENY';

/** Permiso concedido, con el alcance efectivo resuelto. */
export interface GrantedPermission {
  key: string;
  scope: PermissionScope;
}

/**
 * Conjunto de permisos efectivos de un usuario en una organización.
 * Se construye una vez por petición y se consulta muchas veces, así que es un Map.
 */
export class PermissionSet {
  private readonly granted: ReadonlyMap<string, PermissionScope>;

  constructor(
    granted: Iterable<GrantedPermission>,
    /** Un administrador de plataforma supera cualquier comprobación. */
    readonly isSuperAdmin = false,
  ) {
    const map = new Map<string, PermissionScope>();
    for (const g of granted) {
      const prev = map.get(g.key);
      map.set(g.key, prev ? widerScope(prev, g.scope) : g.scope);
    }
    this.granted = map;
  }

  static empty(): PermissionSet {
    return new PermissionSet([]);
  }

  /**
   * Resuelve roles y excepciones: la unión de los roles, más los ALLOW,
   * menos los DENY. DENY siempre gana, sea cual sea su alcance.
   */
  static resolve(
    fromRoles: Iterable<GrantedPermission>,
    overrides: Iterable<{ key: string; effect: PermissionEffect; scope: PermissionScope }> = [],
    isSuperAdmin = false,
  ): PermissionSet {
    const allowed = new Map<string, PermissionScope>();
    for (const g of fromRoles) {
      const prev = allowed.get(g.key);
      allowed.set(g.key, prev ? widerScope(prev, g.scope) : g.scope);
    }
    const denied = new Set<string>();
    for (const o of overrides) {
      if (o.effect === 'DENY') denied.add(o.key);
      else {
        const prev = allowed.get(o.key);
        allowed.set(o.key, prev ? widerScope(prev, o.scope) : o.scope);
      }
    }
    for (const key of denied) allowed.delete(key);
    return new PermissionSet(
      [...allowed].map(([key, scope]) => ({ key, scope })),
      isSuperAdmin,
    );
  }

  can(key: string): boolean {
    return this.isSuperAdmin || this.granted.has(key);
  }

  /** Alcance concedido, o `null` si no tiene el permiso. */
  scopeOf(key: string): PermissionScope | null {
    if (this.isSuperAdmin) return 'ORG';
    return this.granted.get(key) ?? null;
  }

  /** ¿Tiene el permiso con al menos este alcance? */
  canWithScope(key: string, min: PermissionScope): boolean {
    const scope = this.scopeOf(key);
    return scope !== null && scopeRank(scope) >= scopeRank(min);
  }

  canAny(keys: readonly string[]): boolean {
    return keys.some((k) => this.can(k));
  }

  canAll(keys: readonly string[]): boolean {
    return keys.every((k) => this.can(k));
  }

  /** Serialización que viaja al frontend para pintar el menú y ocultar acciones. */
  toJSON(): Record<string, PermissionScope> {
    if (this.isSuperAdmin) return { '*': 'ORG' };
    return Object.fromEntries(this.granted);
  }

  static fromJSON(json: Record<string, PermissionScope>): PermissionSet {
    if (json['*']) return new PermissionSet([], true);
    return new PermissionSet(Object.entries(json).map(([key, scope]) => ({ key, scope })));
  }

  get size(): number {
    return this.granted.size;
  }
}
