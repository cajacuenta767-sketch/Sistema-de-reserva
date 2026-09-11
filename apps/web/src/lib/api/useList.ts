import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { get } from './client';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  aggregates?: Record<string, string | number>;
}

/**
 * Hook de listado.
 *
 * `keepPreviousData` es lo que evita que la tabla parpadee al cambiar de página:
 * mantiene las filas anteriores mientras llegan las nuevas, en lugar de vaciar
 * la tabla y provocar un salto de layout en cada clic.
 */
export function useList<T>(
  path: string,
  query: URLSearchParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<Paged<T>> {
  return useQuery({
    queryKey: [path, query.toString()],
    queryFn: ({ signal }) => get<Paged<T>>(path, query, signal),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useCollection<T>(
  path: string,
  options: { enabled?: boolean; staleTime?: number } = {},
): UseQueryResult<{ items: T[] }> {
  return useQuery({
    queryKey: [path],
    queryFn: ({ signal }) => get<{ items: T[] }>(path, undefined, signal),
    enabled: options.enabled ?? true,
    staleTime: options.staleTime ?? 60_000,
  });
}

/**
 * Hook para un recurso suelto: una ficha, un resumen, un objeto de configuración.
 *
 * Distinto de `useCollection` porque estos endpoints NO devuelven `{ items }`
 * sino el objeto directamente. Forzarlos a través del hook de colecciones
 * obligaba a hacer un `as` en cada pantalla, y un `as` es justo donde el tipo
 * deja de comprobar nada.
 */
export function useResource<T>(
  path: string | null,
  options: { enabled?: boolean; staleTime?: number } = {},
): UseQueryResult<T> {
  return useQuery({
    queryKey: [path],
    queryFn: ({ signal }) => get<T>(path as string, undefined, signal),
    enabled: (options.enabled ?? true) && path !== null,
    staleTime: options.staleTime ?? 30_000,
  });
}
