import { describe, expect, it } from 'vitest';
import { parseFilters, parseSort, stateToQuery } from '@/lib/url/useTableState';

/**
 * El estado de la tabla viaja en la URL del navegador con EXACTAMENTE el mismo
 * formato que la querystring de la API. Si las dos se separan, un enlace
 * compartido deja de reproducir la vista que se quiso compartir, y eso no lo
 * detecta ningún test de backend.
 */

describe('parseSort', () => {
  it('interpreta el prefijo - como descendente', () => {
    expect(parseSort('-issue_date,number')).toEqual([
      { field: 'issue_date', dir: 'desc' },
      { field: 'number', dir: 'asc' },
    ]);
  });

  it('sin orden devuelve una lista vacía', () => {
    expect(parseSort(null)).toEqual([]);
    expect(parseSort('')).toEqual([]);
  });
});

describe('parseFilters', () => {
  const of = (query: string) => parseFilters(new URLSearchParams(query));

  it('un valor suelto es igualdad', () => {
    expect(of('filter[status]=ISSUED')).toEqual([{ field: 'status', op: 'eq', value: 'ISSUED' }]);
  });

  it('los operadores explícitos se leen del segundo corchete', () => {
    expect(of('filter[issue_date][gte]=2026-01-01')).toEqual([
      { field: 'issue_date', op: 'gte', value: '2026-01-01' },
    ]);
  });

  it('in, nin y between reciben listas', () => {
    expect(of('filter[status][in]=A,B')).toEqual([{ field: 'status', op: 'in', value: ['A', 'B'] }]);
    expect(of('filter[total][between]=100,500')).toEqual([
      { field: 'total', op: 'between', value: ['100', '500'] },
    ]);
  });

  it('isnull se convierte en booleano', () => {
    expect(of('filter[owner][isnull]=true')).toEqual([{ field: 'owner', op: 'isnull', value: true }]);
    expect(of('filter[owner][isnull]=false')).toEqual([{ field: 'owner', op: 'isnull', value: false }]);
  });

  it('ignora parámetros que no son filtros y filtros vacíos', () => {
    expect(of('page=2&sort=-name&filter[city]=')).toEqual([]);
  });
});

describe('ida y vuelta', () => {
  it('lo que se serializa se vuelve a leer igual', () => {
    const state = {
      page: 3,
      pageSize: 50,
      sort: [{ field: 'issue_date', dir: 'desc' as const }],
      search: 'acme',
      filters: [
        { field: 'status', op: 'in' as const, value: ['ISSUED', 'OVERDUE'] },
        { field: 'issue_date', op: 'gte' as const, value: '2026-01-01' },
      ],
    };

    const query = stateToQuery(state);
    expect(query.get('page')).toBe('3');
    expect(query.get('pageSize')).toBe('50');
    expect(query.get('sort')).toBe('-issue_date');
    expect(query.get('q')).toBe('acme');

    expect(parseSort(query.get('sort'))).toEqual(state.sort);
    expect(parseFilters(query)).toEqual(state.filters);
  });
});
