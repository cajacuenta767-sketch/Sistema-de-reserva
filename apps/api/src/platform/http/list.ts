import { AppError } from '@erp/core';
import type { FilterClause, ListQuery, SortClause } from '@erp/contracts';
import type { Tx } from '../db/unitOfWork.js';
import type { ScopeFilter } from '../authz/scope.js';

/**
 * Traductor del contrato de listado a SQL.
 *
 * Dos propiedades no negociables:
 *
 *  1. **Lista blanca**. Solo se puede filtrar y ordenar por campos declarados en
 *     `fields`. Un nombre de columna jamás llega desde el cliente al SQL: se
 *     busca en el mapa y se usa la expresión declarada. Sin esto, `sort` sería
 *     una inyección SQL de manual.
 *
 *  2. **El alcance se empuja a la consulta**. El filtro de permisos se añade
 *     aquí, junto al resto del WHERE, así que la paginación y los agregados
 *     cuentan exactamente lo que el usuario puede ver.
 */

export type FieldType = 'text' | 'number' | 'date' | 'timestamp' | 'uuid' | 'boolean' | 'array';

export interface FieldDef {
  /** Expresión SQL, normalmente `alias.columna`. */
  column: string;
  type: FieldType;
  sortable?: boolean;
  filterable?: boolean;
  /** Entra en la búsqueda de texto libre `?q=`. Solo tiene sentido en texto. */
  searchable?: boolean;
}

export interface ListSpec {
  /** `FROM` completo con sus JOIN, sin `WHERE`. */
  from: string;
  /** Lista de columnas del `SELECT`. */
  select: string;
  fields: Record<string, FieldDef>;
  /** Condiciones siempre presentes, p. ej. `p.deleted_at IS NULL`. */
  baseWhere?: string[];
  /**
   * Valores para los `$1…$n` que use `baseWhere`.
   *
   * Un listado acotado a un padre (las líneas de una lista de precios, las de
   * una factura) recibe ese identificador por la URL. Interpolarlo en el SQL
   * sería la única inyección posible en este constructor, justo después de
   * haberla cerrado en `sort` y en los filtros. Con esto el valor viaja como
   * parámetro y los filtros del usuario se numeran a continuación.
   */
  baseParams?: readonly unknown[];
  defaultSort?: SortClause[];
  /** Columna que indica el responsable, para el alcance OWN/TEAM. */
  ownerColumn?: string;
  /** Columna de sucursal, para el alcance BRANCH. */
  branchColumn?: string;
  /** Agregados calculados sobre TODO el conjunto filtrado, no sobre la página. */
  aggregates?: Record<string, string>;
  /** Necesario cuando el FROM agrupa; se usa en el conteo. */
  countExpression?: string;
}

interface Builder {
  where: string[];
  params: unknown[];
}

const push = (b: Builder, value: unknown): string => {
  b.params.push(value);
  return `$${b.params.length}`;
};

const castFor = (type: FieldType): string => {
  switch (type) {
    case 'number':
      return '::numeric';
    case 'date':
      return '::date';
    case 'timestamp':
      return '::timestamptz';
    case 'uuid':
      return '::uuid';
    case 'boolean':
      return '::boolean';
    default:
      return '';
  }
};

const applyFilter = (b: Builder, field: FieldDef, clause: FilterClause): void => {
  const col = field.column;
  const cast = castFor(field.type);
  const asArray = (v: FilterClause['value']): string[] => (Array.isArray(v) ? v : [String(v)]);

  switch (clause.op) {
    case 'eq':
      if (field.type === 'array') {
        b.where.push(`${push(b, String(clause.value))} = ANY(${col})`);
      } else {
        b.where.push(`${col} = ${push(b, clause.value)}${cast}`);
      }
      return;
    case 'ne':
      b.where.push(`${col} IS DISTINCT FROM ${push(b, clause.value)}${cast}`);
      return;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const ops = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;
      b.where.push(`${col} ${ops[clause.op]} ${push(b, clause.value)}${cast}`);
      return;
    }
    case 'in':
      b.where.push(`${col} = ANY(${push(b, asArray(clause.value))}${cast ? `${cast}[]` : '::text[]'})`);
      return;
    case 'nin':
      b.where.push(
        `(${col} IS NULL OR NOT (${col} = ANY(${push(b, asArray(clause.value))}${cast ? `${cast}[]` : '::text[]'})))`,
      );
      return;
    case 'like':
      // `unaccent` no está disponible por defecto; `ILIKE` ya resuelve
      // mayúsculas y es suficiente para buscar por nombre.
      b.where.push(`${col}::text ILIKE ${push(b, `%${String(clause.value)}%`)}`);
      return;
    case 'between': {
      const [from, to] = asArray(clause.value);
      if (from === undefined || to === undefined) {
        throw AppError.validation(`El filtro "between" de ${clause.field} necesita dos valores`);
      }
      b.where.push(`${col} BETWEEN ${push(b, from)}${cast} AND ${push(b, to)}${cast}`);
      return;
    }
    case 'isnull':
      b.where.push(clause.value === true ? `${col} IS NULL` : `${col} IS NOT NULL`);
      return;
  }
};

const applyScope = (b: Builder, spec: ListSpec, scope: ScopeFilter): void => {
  if (scope.ownerMembershipId !== undefined) {
    if (!spec.ownerColumn) {
      throw new Error(
        `El listado usa alcance OWN pero su ListSpec no declara "ownerColumn". ` +
          'Sin esa columna el alcance no se puede aplicar y el listado devolvería de más.',
      );
    }
    b.where.push(`${spec.ownerColumn} = ${push(b, scope.ownerMembershipId)}::uuid`);
  }
  if (scope.ownerMembershipIdIn !== undefined) {
    if (!spec.ownerColumn) throw new Error('El listado usa alcance TEAM pero no declara "ownerColumn".');
    b.where.push(`${spec.ownerColumn} = ANY(${push(b, scope.ownerMembershipIdIn)}::uuid[])`);
  }
  if (scope.branchIdIn !== undefined) {
    if (!spec.branchColumn) throw new Error('El listado usa alcance BRANCH pero no declara "branchColumn".');
    // Una fila sin sucursal es de la organización entera: la ven todos.
    b.where.push(
      `(${spec.branchColumn} IS NULL OR ${spec.branchColumn} = ANY(${push(b, scope.branchIdIn)}::uuid[]))`,
    );
  }
};

const buildWhere = (spec: ListSpec, query: ListQuery, scope: ScopeFilter): Builder => {
  const b: Builder = { where: [...(spec.baseWhere ?? [])], params: [...(spec.baseParams ?? [])] };

  /*
   * Cada parámetro base se ANCLA al WHERE con una condición trivialmente cierta.
   *
   * `runList` lanza tres consultas —filas, conteo y agregados— con la MISMA
   * lista de parámetros, pero cada una arma su SQL con partes distintas: el
   * conteo solo usa `from` y `where`. Un parámetro base que solo aparezca en
   * `select` o en `aggregates` llega a la consulta de conteo sin que su texto lo
   * mencione, y PostgreSQL rechaza la consulta entera. El síntoma es un 500 que
   * aparece solo con ciertos filtros, que es de lo más difícil de rastrear.
   *
   * Anclarlos aquí cuesta una comparación constante por consulta y permite
   * usarlos en cualquier parte del `ListSpec`, que es donde hacen falta: la
   * fecha con la que se decide si una factura está vencida se necesita en el
   * SELECT, en los filtros y en los agregados.
   */
  for (let i = 0; i < b.params.length; i += 1) {
    b.where.push(`$${i + 1}::text IS NOT NULL`);
  }

  for (const clause of query.filters) {
    const field = spec.fields[clause.field];
    if (!field || field.filterable === false) {
      throw AppError.validation(`No se puede filtrar por "${clause.field}"`, {
        allowed: Object.keys(spec.fields).filter((f) => spec.fields[f]?.filterable !== false),
      });
    }
    applyFilter(b, field, clause);
  }

  if (query.search) {
    const searchable = Object.values(spec.fields).filter((f) => f.searchable);
    if (searchable.length > 0) {
      const param = push(b, `%${query.search}%`);
      b.where.push(`(${searchable.map((f) => `${f.column}::text ILIKE ${param}`).join(' OR ')})`);
    }
  }

  applyScope(b, spec, scope);
  return b;
};

const buildOrderBy = (spec: ListSpec, sort: SortClause[]): string => {
  const clauses = (sort.length > 0 ? sort : (spec.defaultSort ?? [])).map((s) => {
    const field = spec.fields[s.field];
    if (!field || field.sortable === false) {
      throw AppError.validation(`No se puede ordenar por "${s.field}"`, {
        allowed: Object.keys(spec.fields).filter((f) => spec.fields[f]?.sortable !== false),
      });
    }
    // NULLS LAST en descendente evita que las filas sin dato copen la primera página.
    return `${field.column} ${s.dir === 'desc' ? 'DESC NULLS LAST' : 'ASC NULLS LAST'}`;
  });
  return clauses.length > 0 ? `ORDER BY ${clauses.join(', ')}` : '';
};

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  aggregates?: Record<string, string | number>;
}

/**
 * Ejecuta el listado: página de datos, conteo total y agregados, en tres
 * consultas paralelas sobre la misma transacción.
 */
export const runList = async <T extends Record<string, unknown>>(
  tx: Tx,
  spec: ListSpec,
  query: ListQuery,
  scope: ScopeFilter = {},
): Promise<ListResult<T>> => {
  const b = buildWhere(spec, query, scope);
  const whereSql = b.where.length > 0 ? `WHERE ${b.where.join(' AND ')}` : '';
  const orderBy = buildOrderBy(spec, query.sort);

  const limitParam = `$${b.params.length + 1}`;
  const offsetParam = `$${b.params.length + 2}`;

  // Secuencial, no en paralelo: las tres consultas comparten el cliente de la
  // transacción (lo exige RLS) y una conexión de PostgreSQL ejecuta una sola
  // consulta a la vez. Un Promise.all aquí no ganaría nada y node-postgres lo
  // ha marcado como obsoleto.
  const rows = await tx.client.query<T>(
    `SELECT ${spec.select} ${spec.from} ${whereSql} ${orderBy} LIMIT ${limitParam} OFFSET ${offsetParam}`,
    [...b.params, query.pageSize, query.offset],
  );

  const count = await tx.client.query<{ total: string }>(
    `SELECT count(${spec.countExpression ?? '*'})::bigint AS total ${spec.from} ${whereSql}`,
    b.params,
  );

  const aggregateEntries = Object.entries(spec.aggregates ?? {});
  const aggs =
    aggregateEntries.length > 0
      ? await tx.client.query<Record<string, string>>(
          `SELECT ${aggregateEntries.map(([alias, expr]) => `${expr} AS "${alias}"`).join(', ')} ` +
            `${spec.from} ${whereSql}`,
          b.params,
        )
      : null;

  const result: ListResult<T> = {
    items: rows.rows,
    total: Number(count.rows[0]?.total ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
  if (aggs?.rows[0]) result.aggregates = aggs.rows[0];
  return result;
};

/** Campos de auditoría que casi todo listado expone. Evita repetirlos en cada spec. */
export const auditFields = (alias: string): Record<string, FieldDef> => ({
  created_at: { column: `${alias}.created_at`, type: 'timestamp', sortable: true, filterable: true },
  updated_at: { column: `${alias}.updated_at`, type: 'timestamp', sortable: true, filterable: true },
});
