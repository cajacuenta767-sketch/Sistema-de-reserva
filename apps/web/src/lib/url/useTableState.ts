import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_PAGE_SIZE, type FilterClause, type FilterOperator, type SortClause } from '@erp/contracts';

/**
 * Estado de la tabla en la URL.
 *
 * No es un capricho: hace que cualquier vista filtrada sea un enlace que se
 * puede pegar en un correo, que el botón Atrás del navegador funcione como la
 * gente espera, y que recargar no pierda el trabajo de filtrar. Guardarlo en
 * `useState` rompe las tres cosas.
 *
 * El formato es EXACTAMENTE el del contrato del backend, así que la querystring
 * del navegador y la de la API son la misma cadena.
 */

export interface TableState {
  page: number;
  pageSize: number;
  sort: SortClause[];
  search: string;
  filters: FilterClause[];
}

const parseFilters = (params: URLSearchParams): FilterClause[] => {
  const filters: FilterClause[] = [];
  for (const [key, value] of params.entries()) {
    const match = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/.exec(key);
    if (!match?.[1] || value === '') continue;
    const field = match[1];
    const op = (match[2] ?? 'eq') as FilterOperator;

    if (op === 'isnull') filters.push({ field, op, value: value !== 'false' });
    else if (op === 'in' || op === 'nin' || op === 'between') {
      filters.push({ field, op, value: value.split(',') });
    } else filters.push({ field, op, value });
  }
  return filters;
};

const parseSort = (raw: string | null): SortClause[] =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s.startsWith('-')
        ? { field: s.slice(1), dir: 'desc' as const }
        : { field: s.replace(/^\+/, ''), dir: 'asc' as const },
    );

export interface UseTableStateOptions {
  defaultSort?: SortClause[];
  defaultPageSize?: number;
  /** Prefijo para tener dos tablas independientes en la misma página. */
  namespace?: string;
}

export function useTableState(options: UseTableStateOptions = {}) {
  const { defaultSort = [], defaultPageSize = DEFAULT_PAGE_SIZE, namespace = '' } = options;
  const [params, setParams] = useSearchParams();

  const prefixed = useCallback((key: string) => (namespace ? `${namespace}.${key}` : key), [namespace]);

  const state = useMemo<TableState>(() => {
    const sort = parseSort(params.get(prefixed('sort')));
    return {
      page: Math.max(1, Number(params.get(prefixed('page')) ?? 1)),
      pageSize: Number(params.get(prefixed('pageSize')) ?? defaultPageSize),
      sort: sort.length > 0 ? sort : defaultSort,
      search: params.get(prefixed('q')) ?? '',
      filters: parseFilters(params),
    };
  }, [params, prefixed, defaultPageSize, defaultSort]);

  const update = useCallback(
    (patch: Partial<TableState>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);

          if (patch.sort !== undefined) {
            const value = patch.sort.map((s) => (s.dir === 'desc' ? `-${s.field}` : s.field)).join(',');
            if (value) next.set(prefixed('sort'), value);
            else next.delete(prefixed('sort'));
          }

          if (patch.search !== undefined) {
            if (patch.search) next.set(prefixed('q'), patch.search);
            else next.delete(prefixed('q'));
          }

          if (patch.pageSize !== undefined) {
            if (patch.pageSize === defaultPageSize) next.delete(prefixed('pageSize'));
            else next.set(prefixed('pageSize'), String(patch.pageSize));
          }

          if (patch.filters !== undefined) {
            for (const key of [...next.keys()]) if (key.startsWith('filter[')) next.delete(key);
            for (const f of patch.filters) {
              const value = Array.isArray(f.value) ? f.value.join(',') : String(f.value);
              next.set(f.op === 'eq' ? `filter[${f.field}]` : `filter[${f.field}][${f.op}]`, value);
            }
          }

          // Cambiar filtros, orden o búsqueda vuelve a la primera página: si no,
          // el usuario se queda mirando una página 7 que ya no existe.
          const resetsPage =
            patch.filters !== undefined || patch.search !== undefined || patch.sort !== undefined;
          const page = patch.page ?? (resetsPage ? 1 : state.page);
          if (page <= 1) next.delete(prefixed('page'));
          else next.set(prefixed('page'), String(page));

          return next;
        },
        { replace: true },
      );
    },
    [setParams, prefixed, defaultPageSize, state.page],
  );

  /** Alterna el orden de una columna: asc → desc → sin orden. */
  const toggleSort = useCallback(
    (field: string) => {
      const current = state.sort.find((s) => s.field === field);
      if (!current) update({ sort: [{ field, dir: 'asc' }] });
      else if (current.dir === 'asc') update({ sort: [{ field, dir: 'desc' }] });
      else update({ sort: [] });
    },
    [state.sort, update],
  );

  const setFilter = useCallback(
    (field: string, op: FilterOperator, value: FilterClause['value'] | null) => {
      const rest = state.filters.filter((f) => !(f.field === field && f.op === op));
      update({
        filters:
          value === null || value === '' || (Array.isArray(value) && value.length === 0)
            ? rest
            : [...rest, { field, op, value }],
      });
    },
    [state.filters, update],
  );

  const clearFilters = useCallback(() => update({ filters: [], search: '' }), [update]);

  /** Querystring lista para la API: el mismo formato que la del navegador. */
  const toQuery = useCallback((): URLSearchParams => {
    const q = new URLSearchParams();
    q.set('page', String(state.page));
    q.set('pageSize', String(state.pageSize));
    if (state.sort.length > 0) {
      q.set('sort', state.sort.map((s) => (s.dir === 'desc' ? `-${s.field}` : s.field)).join(','));
    }
    if (state.search) q.set('q', state.search);
    for (const f of state.filters) {
      const value = Array.isArray(f.value) ? f.value.join(',') : String(f.value);
      q.set(f.op === 'eq' ? `filter[${f.field}]` : `filter[${f.field}][${f.op}]`, value);
    }
    return q;
  }, [state]);

  return { state, update, toggleSort, setFilter, clearFilters, toQuery };
}
