import { describe, expect, it } from 'vitest';
import { crudPermissions, definePermission, PermissionSet, widerScope } from '../src/common/permissions.js';

describe('definePermission', () => {
  it('descompone la clave en módulo, recurso y acción', () => {
    const p = definePermission('sales:invoice:create', 'Crear facturas');
    expect(p).toMatchObject({ module: 'sales', resource: 'invoice', action: 'create' });
  });

  it('rechaza claves mal formadas', () => {
    expect(() => definePermission('sales:invoice', 'x')).toThrow(/inválida/);
  });

  it('crudPermissions genera los cinco permisos', () => {
    const keys = crudPermissions('crm', 'party', 'clientes').map((p) => p.key);
    expect(keys).toEqual([
      'crm:party:read',
      'crm:party:create',
      'crm:party:update',
      'crm:party:delete',
      'crm:party:export',
    ]);
  });
});

describe('PermissionSet', () => {
  it('widerScope se queda con el alcance mayor', () => {
    expect(widerScope('OWN', 'ORG')).toBe('ORG');
    expect(widerScope('BRANCH', 'TEAM')).toBe('BRANCH');
  });

  it('la unión de dos roles se queda con el alcance más amplio', () => {
    const set = PermissionSet.resolve([
      { key: 'sales:invoice:read', scope: 'OWN' },
      { key: 'sales:invoice:read', scope: 'BRANCH' },
    ]);
    expect(set.scopeOf('sales:invoice:read')).toBe('BRANCH');
  });

  it('DENY gana sobre cualquier ALLOW', () => {
    const set = PermissionSet.resolve(
      [{ key: 'sales:invoice:delete', scope: 'ORG' }],
      [{ key: 'sales:invoice:delete', effect: 'DENY', scope: 'ORG' }],
    );
    expect(set.can('sales:invoice:delete')).toBe(false);
  });

  it('un ALLOW puntual concede un permiso que ningún rol otorga', () => {
    const set = PermissionSet.resolve([], [{ key: 'accounting:entry:post', effect: 'ALLOW', scope: 'ORG' }]);
    expect(set.can('accounting:entry:post')).toBe(true);
  });

  it('canWithScope compara por rango', () => {
    const set = PermissionSet.resolve([{ key: 'crm:party:read', scope: 'TEAM' }]);
    expect(set.canWithScope('crm:party:read', 'OWN')).toBe(true);
    expect(set.canWithScope('crm:party:read', 'TEAM')).toBe(true);
    expect(set.canWithScope('crm:party:read', 'ORG')).toBe(false);
  });

  it('el superadministrador supera cualquier comprobación', () => {
    const set = PermissionSet.resolve([], [], true);
    expect(set.can('cualquier:cosa:inventada')).toBe(true);
    expect(set.scopeOf('cualquier:cosa:inventada')).toBe('ORG');
  });

  it('sobrevive a la ida y vuelta por JSON', () => {
    const set = PermissionSet.resolve([{ key: 'crm:party:read', scope: 'TEAM' }]);
    const back = PermissionSet.fromJSON(set.toJSON());
    expect(back.scopeOf('crm:party:read')).toBe('TEAM');
    expect(PermissionSet.fromJSON(PermissionSet.resolve([], [], true).toJSON()).isSuperAdmin).toBe(true);
  });

  it('un conjunto vacío no concede nada', () => {
    expect(PermissionSet.empty().can('crm:party:read')).toBe(false);
    expect(PermissionSet.empty().scopeOf('crm:party:read')).toBeNull();
  });
});
