/** Sobre de respuesta que TODOS los endpoints de listado devuelven. */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** Totales calculados en servidor sobre el conjunto filtrado completo, no solo la página. */
  aggregates?: Record<string, string | number>;
}

export const emptyPage = <T>(page = 1, pageSize = 25): Paged<T> => ({
  items: [],
  total: 0,
  page,
  pageSize,
});

export const pageOf = <T>(items: T[], total: number, page: number, pageSize: number): Paged<T> => ({
  items,
  total,
  page,
  pageSize,
});

export const offsetOf = (page: number, pageSize: number): number => (Math.max(1, page) - 1) * pageSize;

export const totalPages = (total: number, pageSize: number): number =>
  pageSize > 0 ? Math.ceil(total / pageSize) : 0;
