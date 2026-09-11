import { z } from 'zod';

/**
 * Contrato ÚNICO de listado. Todos los endpoints de lista del sistema lo respetan,
 * y un test de contrato lo verifica. Esa uniformidad es lo que permite que la
 * DataTable del frontend funcione con cualquier módulo sin adaptadores.
 *
 *   GET /api/v1/sales/invoices
 *     ?page=1&pageSize=25
 *     &sort=-issue_date,number
 *     &q=acme
 *     &filter[status]=ISSUED,OVERDUE
 *     &filter[issue_date][gte]=2026-01-01
 *     &filter[total][between]=1000,5000
 *     &filter[owner_id][isnull]=true
 */

export const FILTER_OPERATORS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'like',
  'between',
  'isnull',
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface FilterClause {
  field: string;
  op: FilterOperator;
  value: string | string[] | boolean;
}

export interface SortClause {
  field: string;
  dir: 'asc' | 'desc';
}

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 25;

// `partialRecord` (Zod v4) permite un subconjunto de operadores; `record` con un
// enum exigiría que estuvieran TODOS presentes. Un operador desconocido se rechaza
// con 400 en vez de ignorarse: un filtro que no se aplica devolvería de más.
const operatorObject = z.partialRecord(z.enum(FILTER_OPERATORS), z.union([z.string(), z.array(z.string())]));

/** Lo que llega por querystring, antes de normalizar. */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  /** Campos separados por coma; el prefijo `-` indica descendente. */
  sort: z.string().max(200).optional(),
  /** Búsqueda de texto libre sobre los campos marcados como buscables del módulo. */
  q: z.string().trim().max(200).optional(),
  filter: z.record(z.string(), z.union([z.string(), z.array(z.string()), operatorObject])).optional(),
  /** Devuelve todas las filas que cumplen el filtro, sin paginar (solo para exportar). */
  all: z.coerce.boolean().optional(),
});

export type ListQueryInput = z.input<typeof listQuerySchema>;
export type ListQueryParsed = z.output<typeof listQuerySchema>;

/** Consulta ya normalizada, lista para que el repositorio la traduzca a SQL. */
export interface ListQuery {
  page: number;
  pageSize: number;
  offset: number;
  sort: SortClause[];
  search?: string;
  filters: FilterClause[];
  all: boolean;
}

const splitList = (v: string | string[]): string[] =>
  Array.isArray(v)
    ? v
    : v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

export const parseSort = (sort: string | undefined): SortClause[] => {
  if (!sort) return [];
  return sort
    .split(',')
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) =>
      raw.startsWith('-')
        ? { field: raw.slice(1), dir: 'desc' as const }
        : { field: raw.replace(/^\+/, ''), dir: 'asc' as const },
    );
};

export const normalizeListQuery = (parsed: ListQueryParsed): ListQuery => {
  const filters: FilterClause[] = [];

  for (const [field, raw] of Object.entries(parsed.filter ?? {})) {
    if (raw === undefined || raw === null) continue;

    if (typeof raw === 'string' || Array.isArray(raw)) {
      const values = splitList(raw);
      if (values.length === 0) continue;
      // Un valor suelto es igualdad; varios separados por coma son un IN.
      filters.push(
        values.length === 1 && values[0] !== undefined
          ? { field, op: 'eq', value: values[0] }
          : { field, op: 'in', value: values },
      );
      continue;
    }

    for (const [op, value] of Object.entries(raw)) {
      if (value === undefined) continue;
      const operator = op as FilterOperator;
      if (operator === 'isnull') {
        filters.push({ field, op: operator, value: String(value) !== 'false' });
      } else if (operator === 'in' || operator === 'nin' || operator === 'between') {
        filters.push({ field, op: operator, value: splitList(value) });
      } else {
        filters.push({ field, op: operator, value: Array.isArray(value) ? (value[0] ?? '') : value });
      }
    }
  }

  const all = parsed.all === true;
  const pageSize = all ? MAX_PAGE_SIZE : parsed.pageSize;

  const q: ListQuery = {
    page: parsed.page,
    pageSize,
    offset: (parsed.page - 1) * pageSize,
    sort: parseSort(parsed.sort),
    filters,
    all,
  };
  if (parsed.q !== undefined && parsed.q !== '') q.search = parsed.q;
  return q;
};

/** Serializa de vuelta a querystring. Lo usa el frontend para enlaces compartibles. */
export const listQueryToSearchParams = (q: Partial<ListQuery>): URLSearchParams => {
  const p = new URLSearchParams();
  if (q.page && q.page > 1) p.set('page', String(q.page));
  if (q.pageSize && q.pageSize !== DEFAULT_PAGE_SIZE) p.set('pageSize', String(q.pageSize));
  if (q.sort?.length)
    p.set('sort', q.sort.map((s) => (s.dir === 'desc' ? `-${s.field}` : s.field)).join(','));
  if (q.search) p.set('q', q.search);
  for (const f of q.filters ?? []) {
    const value = Array.isArray(f.value) ? f.value.join(',') : String(f.value);
    p.set(f.op === 'eq' ? `filter[${f.field}]` : `filter[${f.field}][${f.op}]`, value);
  }
  return p;
};
