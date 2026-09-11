import { describe, expect, it } from 'vitest';
import {
  matchesPattern,
  resolveTemplate,
  SYSTEM_ROLE_TEMPLATES,
} from '../../src/modules/identity/domain/roleTemplates.js';

describe('matchesPattern', () => {
  it('casa la clave exacta', () => {
    expect(matchesPattern('crm:party:read', 'crm:party:read')).toBe(true);
    expect(matchesPattern('crm:party:read', 'crm:party:create')).toBe(false);
  });

  it('el comodín final absorbe el resto', () => {
    expect(matchesPattern('accounting:*', 'accounting:journal:post')).toBe(true);
    expect(matchesPattern('accounting:*', 'accounting:entry')).toBe(true);
    expect(matchesPattern('accounting:*', 'sales:invoice:read')).toBe(false);
    // Un patrón de dos segmentos no casa con una clave de uno.
    expect(matchesPattern('accounting:*', 'accounting')).toBe(false);
  });

  it('el comodín intermedio casa UN segmento', () => {
    // El caso que la versión anterior fallaba en silencio: ni exacto ni
    // terminado en `*`, así que no concedía nada.
    expect(matchesPattern('sales:*:read', 'sales:invoice:read')).toBe(true);
    expect(matchesPattern('sales:*:read', 'sales:quote:read')).toBe(true);
    expect(matchesPattern('sales:*:read', 'sales:invoice:create')).toBe(false);
    expect(matchesPattern('catalog:*:read', 'catalog:product:read')).toBe(true);
    expect(matchesPattern('catalog:*:read', 'catalog:product:create')).toBe(false);
  });

  it('`*` a secas casa con todo', () => {
    expect(matchesPattern('*', 'cualquier:cosa:que:sea')).toBe(true);
  });

  it('no casa si el patrón es más largo que la clave', () => {
    expect(matchesPattern('sales:invoice:read', 'sales:invoice')).toBe(false);
    expect(matchesPattern('sales:*:read', 'sales:invoice')).toBe(false);
  });
});

describe('resolveTemplate', () => {
  const CATALOG = [
    'catalog:product:read',
    'catalog:product:create',
    'catalog:product:delete',
    'sales:invoice:read',
    'sales:invoice:create',
    'sales:invoice:delete',
    'sales:quote:read',
    'accounting:journal:post',
    'org:organization:read',
    'org:organization:update',
  ];

  it('el comercial ve el catálogo pero no lo modifica', () => {
    const template = SYSTEM_ROLE_TEMPLATES.find((t) => t.code === 'SALES');
    const granted = resolveTemplate(template!, CATALOG);
    const keys = granted.map((g) => g.key);

    expect(keys).toContain('catalog:product:read');
    expect(keys).not.toContain('catalog:product:create');
    expect(keys).not.toContain('catalog:product:delete');
  });

  it('el contador lee las ventas sin poder emitirlas', () => {
    const template = SYSTEM_ROLE_TEMPLATES.find((t) => t.code === 'ACCOUNTANT');
    const keys = resolveTemplate(template!, CATALOG).map((g) => g.key);

    expect(keys).toContain('sales:invoice:read');
    expect(keys).toContain('sales:quote:read');
    expect(keys).toContain('accounting:journal:post');
    expect(keys).not.toContain('sales:invoice:create');
  });

  it('las exclusiones se restan de lo concedido', () => {
    const template = SYSTEM_ROLE_TEMPLATES.find((t) => t.code === 'SALES');
    const keys = resolveTemplate(template!, CATALOG).map((g) => g.key);
    expect(keys).not.toContain('sales:invoice:delete');
    expect(keys).toContain('sales:invoice:create');
  });

  it('el administrador lo tiene todo salvo los datos legales', () => {
    const template = SYSTEM_ROLE_TEMPLATES.find((t) => t.code === 'ADMIN');
    const keys = resolveTemplate(template!, CATALOG).map((g) => g.key);
    expect(keys).toContain('org:organization:read');
    expect(keys).not.toContain('org:organization:update');
    expect(keys.length).toBe(CATALOG.length - 1);
  });

  it('ninguna plantilla del sistema concede cero permisos', () => {
    // Una plantilla vacía es casi siempre un patrón mal escrito, y produce un
    // rol que existe, se puede asignar, y no deja hacer nada.
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      const keys = resolveTemplate(template, CATALOG);
      expect(keys.length, template.code).toBeGreaterThan(0);
    }
  });

  it('cada patrón de cada plantilla casa con algo del catálogo real', () => {
    // La prueba que habría cazado `catalog:*:read` sin match: un patrón que no
    // concede nada no falla, simplemente no hace nada.
    const realKeys = [
      ...CATALOG,
      'crm:party:read',
      'banking:account:read',
      'budgeting:budget:read',
      'purchasing:order:read',
      'purchasing:order:export',
      'sales:invoice:export',
      'org:branch:read',
      'projects:project:read',
      'tasks:task:read',
      'timesheets:entry:read',
      'helpdesk:ticket:read',
      'calendar:event:read',
      'platform:import:read',
      'platform:import:create',
    ];
    for (const template of SYSTEM_ROLE_TEMPLATES) {
      for (const grant of template.grants) {
        const hits = realKeys.filter((k) => matchesPattern(grant.pattern, k));
        expect(hits.length, `${template.code} → ${grant.pattern}`).toBeGreaterThan(0);
      }
    }
  });
});
