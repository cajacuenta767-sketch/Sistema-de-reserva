import { describe, expect, it } from 'vitest';
import {
  listQueryToSearchParams,
  listQuerySchema,
  normalizeListQuery,
  parseSort,
} from '../src/common/listQuery.js';

const parse = (raw: unknown) => normalizeListQuery(listQuerySchema.parse(raw));

describe('listQuery', () => {
  it('aplica los valores por defecto', () => {
    const q = parse({});
    expect(q).toMatchObject({ page: 1, pageSize: 25, offset: 0, filters: [], sort: [], all: false });
  });

  it('calcula el offset de la página', () => {
    expect(parse({ page: '3', pageSize: '20' }).offset).toBe(40);
  });

  it('limita pageSize al máximo permitido', () => {
    expect(() => listQuerySchema.parse({ pageSize: '5000' })).toThrow();
  });

  it('interpreta el prefijo - como descendente', () => {
    expect(parseSort('-issue_date,number')).toEqual([
      { field: 'issue_date', dir: 'desc' },
      { field: 'number', dir: 'asc' },
    ]);
  });

  it('un valor suelto es igualdad', () => {
    expect(parse({ filter: { status: 'ISSUED' } }).filters).toEqual([
      { field: 'status', op: 'eq', value: 'ISSUED' },
    ]);
  });

  it('varios valores separados por coma son un IN', () => {
    expect(parse({ filter: { status: 'ISSUED,OVERDUE' } }).filters).toEqual([
      { field: 'status', op: 'in', value: ['ISSUED', 'OVERDUE'] },
    ]);
  });

  it('acepta operadores explícitos', () => {
    const q = parse({ filter: { issue_date: { gte: '2026-01-01', lte: '2026-01-31' } } });
    expect(q.filters).toEqual([
      { field: 'issue_date', op: 'gte', value: '2026-01-01' },
      { field: 'issue_date', op: 'lte', value: '2026-01-31' },
    ]);
  });

  it('between y nin reciben listas', () => {
    const q = parse({ filter: { total: { between: '1000,5000' }, status: { nin: 'VOID,DRAFT' } } });
    expect(q.filters).toContainEqual({ field: 'total', op: 'between', value: ['1000', '5000'] });
    expect(q.filters).toContainEqual({ field: 'status', op: 'nin', value: ['VOID', 'DRAFT'] });
  });

  it('isnull se convierte en booleano', () => {
    expect(parse({ filter: { owner_id: { isnull: 'true' } } }).filters).toEqual([
      { field: 'owner_id', op: 'isnull', value: true },
    ]);
    expect(parse({ filter: { owner_id: { isnull: 'false' } } }).filters).toEqual([
      { field: 'owner_id', op: 'isnull', value: false },
    ]);
  });

  it('ignora filtros vacíos', () => {
    expect(parse({ filter: { status: '' } }).filters).toEqual([]);
  });

  it('ida y vuelta a querystring', () => {
    const original = parse({
      page: '2',
      sort: '-issue_date',
      q: 'acme',
      filter: { status: 'ISSUED,OVERDUE', issue_date: { gte: '2026-01-01' } },
    });
    const params = listQueryToSearchParams(original);
    expect(params.get('page')).toBe('2');
    expect(params.get('sort')).toBe('-issue_date');
    expect(params.get('q')).toBe('acme');
    expect(params.get('filter[status][in]')).toBe('ISSUED,OVERDUE');
    expect(params.get('filter[issue_date][gte]')).toBe('2026-01-01');
  });
});
