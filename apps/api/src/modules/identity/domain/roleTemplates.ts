import type { PermissionScope } from '@erp/contracts';

/**
 * Plantillas de roles.
 *
 * Viven en código, no en una tabla global: al crear una organización se copian
 * a sus propios roles, de modo que cada empresa puede editarlos sin afectar a
 * las demás. Los patrones se resuelven contra el catálogo de permisos en ese
 * momento, así que una plantilla sigue siendo correcta cuando se añade un módulo
 * nuevo: "Contador" gana automáticamente los permisos de contabilidad que se
 * incorporen, sin tener que revisar las plantillas una por una.
 */
export interface RoleGrant {
  /** Clave exacta o patrón con `*` al final: `accounting:*`, `sales:invoice:*`. */
  pattern: string;
  scope: PermissionScope;
}

export interface RoleTemplate {
  code: string;
  name: string;
  description: string;
  grants: RoleGrant[];
  /** Patrones que se restan de lo concedido. */
  excludes?: string[];
}

/**
 * ¿Casa una clave de permiso con un patrón?
 *
 * Las claves son `modulo:recurso:accion`, y el comodín trabaja por segmentos:
 *
 *   · `*`                → todo
 *   · `accounting:*`     → todo el módulo, sea cual sea su profundidad
 *   · `sales:*:read`     → la lectura de cualquier recurso de ventas
 *   · `crm:party:read`   → exactamente esa
 *
 * La versión anterior solo entendía el comodín al final (`pattern.endsWith('*')`),
 * así que `sales:*:read` no casaba con NADA: ni exacta ni terminada en `*`. Las
 * plantillas que lo usaban —Contador y Comercial— concedían en silencio menos
 * permisos de los que decían, y el error solo se veía al toparse con un 403 que
 * no tenía explicación.
 */
export const matchesPattern = (pattern: string, key: string): boolean => {
  if (pattern === key) return true;

  const patternParts = pattern.split(':');
  const keyParts = key.split(':');

  for (let i = 0; i < patternParts.length; i += 1) {
    const part = patternParts[i];
    // Un `*` final absorbe el resto de la clave: `accounting:*` incluye tanto
    // `accounting:journal` como `accounting:journal:post`.
    if (part === '*' && i === patternParts.length - 1) return keyParts.length > i;
    if (i >= keyParts.length) return false;
    if (part !== '*' && part !== keyParts[i]) return false;
  }

  // Sin comodín final, el patrón tiene que cubrir la clave entera: `sales:*`
  // (dos segmentos) no debe casar con `sales` a secas ni dejar cola sin revisar.
  return patternParts.length === keyParts.length;
};

export const SYSTEM_ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    code: 'OWNER',
    name: 'Propietario',
    description: 'Control total, incluidos los datos legales de la empresa y la facturación.',
    grants: [{ pattern: '*', scope: 'ORG' }],
  },
  {
    code: 'ADMIN',
    name: 'Administrador',
    description: 'Gestiona el día a día del sistema y a las personas, sin tocar los datos legales.',
    grants: [{ pattern: '*', scope: 'ORG' }],
    excludes: ['org:organization:update'],
  },
  {
    code: 'ACCOUNTANT',
    name: 'Contador',
    description: 'Contabilidad completa y consulta de todo lo que la alimenta.',
    grants: [
      { pattern: 'accounting:*', scope: 'ORG' },
      { pattern: 'banking:*', scope: 'ORG' },
      { pattern: 'budgeting:*', scope: 'ORG' },
      { pattern: 'sales:*:read', scope: 'ORG' },
      { pattern: 'sales:*:export', scope: 'ORG' },
      { pattern: 'purchasing:*:read', scope: 'ORG' },
      { pattern: 'purchasing:*:export', scope: 'ORG' },
      { pattern: 'crm:party:read', scope: 'ORG' },
      { pattern: 'org:organization:read', scope: 'ORG' },
      { pattern: 'org:branch:read', scope: 'ORG' },
    ],
  },
  {
    code: 'SALES',
    name: 'Comercial',
    description: 'Sus clientes, sus cotizaciones y sus facturas; ve las de su equipo.',
    grants: [
      { pattern: 'crm:*', scope: 'TEAM' },
      { pattern: 'sales:*', scope: 'OWN' },
      { pattern: 'catalog:*:read', scope: 'ORG' },
      // Traer la propia cartera de clientes desde un fichero es trabajo normal
      // de un comercial. No amplía lo que puede crear: importar exige además el
      // permiso de la entidad, así que seguirá sin poder dar de alta productos.
      { pattern: 'platform:import:*', scope: 'ORG' },
      { pattern: 'org:organization:read', scope: 'ORG' },
      { pattern: 'org:branch:read', scope: 'ORG' },
    ],
    excludes: ['sales:invoice:delete'],
  },
  {
    code: 'EMPLOYEE',
    name: 'Empleado',
    description: 'Acceso básico: lo suyo y lo que necesita para trabajar.',
    grants: [
      { pattern: 'projects:*', scope: 'OWN' },
      { pattern: 'tasks:*', scope: 'OWN' },
      { pattern: 'timesheets:*', scope: 'OWN' },
      { pattern: 'helpdesk:ticket:read', scope: 'OWN' },
      { pattern: 'calendar:*', scope: 'OWN' },
      { pattern: 'org:organization:read', scope: 'ORG' },
    ],
  },
] as const;

/** Resuelve una plantilla contra el catálogo real de permisos. */
export const resolveTemplate = (
  template: RoleTemplate,
  allPermissionKeys: readonly string[],
): Array<{ key: string; scope: PermissionScope }> => {
  const granted = new Map<string, PermissionScope>();

  for (const grant of template.grants) {
    for (const key of allPermissionKeys) {
      if (matchesPattern(grant.pattern, key)) granted.set(key, grant.scope);
    }
  }
  for (const exclude of template.excludes ?? []) {
    for (const key of [...granted.keys()]) {
      if (matchesPattern(exclude, key)) granted.delete(key);
    }
  }

  return [...granted].map(([key, scope]) => ({ key, scope }));
};
