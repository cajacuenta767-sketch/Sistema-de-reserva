import { useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Download,
  MoreHorizontal,
  RotateCw,
  Search,
  X,
} from 'lucide-react';
import { cx } from '../primitives/cx.js';
import { Button } from '../primitives/Button.jsx';
import { Input, Select } from '../primitives/fields.jsx';
import { Empty, ErrorState, Skeleton } from '../primitives/feedback.jsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../primitives/overlays.jsx';
import type { TableState } from '@/lib/url/useTableState';
import type { Paged } from '@/lib/api/useList';

/**
 * DataTable.
 *
 * Aparece en unas 40 pantallas del sistema, así que la calidad de este
 * componente decide la del producto entero. Dos decisiones de fondo:
 *
 *  · **Todo ocurre en el servidor**: filtrar, ordenar y paginar. Filtrar en el
 *    cliente funciona con 50 filas y miente con 50.000, porque solo filtra la
 *    página cargada. Los agregados del pie vienen del conjunto completo por el
 *    mismo motivo.
 *
 *  · **En móvil degrada a tarjetas**, no a una tabla con scroll horizontal.
 *    Una tabla de 9 columnas en 400 px es inutilizable aunque se desplace.
 */

export interface Column<T> {
  /** Clave del campo tal como la declara el backend en su `ListSpec`. */
  id: string;
  header: string;
  /** Contenido de la celda. */
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  /** Alineación a la derecha para importes y cantidades. */
  numeric?: boolean;
  /** Se oculta por defecto; el usuario puede activarla. */
  hiddenByDefault?: boolean;
  /** Permiso necesario para ver la columna (costo, margen, salario…). */
  permission?: string;
  width?: string;
  /** Qué mostrar como título de la tarjeta en móvil. */
  primary?: boolean;
}

export interface BulkAction<T> {
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onRun: (rows: T[]) => void | Promise<void>;
}

export interface RowAction<T> {
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  hidden?: (row: T) => boolean;
  onRun: (row: T) => void | Promise<void>;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: Paged<T> | undefined;
  state: TableState;
  onStateChange: (patch: Partial<TableState>) => void;
  onToggleSort: (field: string) => void;
  rowId: (row: T) => string;
  loading?: boolean;
  error?: Error | null;
  onRefresh?: () => void;
  onRowClick?: (row: T) => void;
  rowActions?: RowAction<T>[];
  bulkActions?: BulkAction<T>[];
  /** Controles de filtro específicos del módulo, sobre la tabla. */
  filters?: ReactNode;
  searchPlaceholder?: string;
  /** Pie con totales calculados por el servidor. */
  aggregateLabels?: Record<string, string>;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  /** Filtra columnas por permiso. */
  can?: (permission: string) => boolean;
}

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Props que hacen clicable un elemento con ratón Y con teclado.
 *
 * Un `<div onClick>` sin esto es invisible para quien navega con teclado o
 * lector de pantalla: la fila existe pero no se puede abrir.
 */
const clickableProps = (onActivate: (() => void) | undefined) =>
  onActivate
    ? {
        role: 'button' as const,
        tabIndex: 0,
        // Se ignoran los clics nacidos dentro de una zona marcada como acción.
        // Es preferible a envolver esas zonas en un div con `stopPropagation`:
        // ese div parece interactivo sin serlo, y no lo es para el teclado.
        onClick: (e: React.MouseEvent) => {
          if ((e.target as HTMLElement).closest('[data-row-action]')) return;
          onActivate();
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onActivate();
          }
        },
      }
    : {};

export function DataTable<T>({
  columns,
  data,
  state,
  onStateChange,
  onToggleSort,
  rowId,
  loading,
  error,
  onRefresh,
  onRowClick,
  rowActions = [],
  bulkActions = [],
  filters,
  searchPlaceholder = 'Buscar…',
  aggregateLabels,
  emptyTitle = 'Sin resultados',
  emptyDescription,
  emptyAction,
  can,
}: DataTableProps<T>) {
  const visibleByPermission = useMemo(
    () => columns.filter((c) => !c.permission || !can || can(c.permission)),
    [columns, can],
  );

  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(visibleByPermission.filter((c) => c.hiddenByDefault).map((c) => c.id)),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchDraft, setSearchDraft] = useState(state.search);

  const visible = visibleByPermission.filter((c) => !hidden.has(c.id));
  const rows = data?.items ?? [];
  const selectable = bulkActions.length > 0;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(rowId(r)));
  const someSelected = rows.some((r) => selected.has(rowId(r)));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map(rowId)));
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = rows.filter((r) => selected.has(rowId(r)));
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const activeFilters = state.filters.length + (state.search ? 1 : 0);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onStateChange({ search: searchDraft });
  };

  const exportCsv = () => {
    const header = visible.map((c) => `"${c.header.replace(/"/g, '""')}"`).join(',');
    const body = rows
      .map((row) =>
        visible
          .map((c) => {
            const value = c.cell(row);
            const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
            return `"${text.replace(/"/g, '""')}"`;
          })
          .join(','),
      )
      .join('\n');
    // BOM para que Excel en Windows no destroce los acentos.
    const blob = new Blob([`\ufeff${header}\n${body}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card overflow-hidden">
      {/* ── Barra de herramientas ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        {/* En móvil el buscador ocupa su propia fila: compartirla con los
            filtros lo deja reducido al icono de la lupa. */}
        <form
          onSubmit={submitSearch}
          className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto sm:max-w-xs"
        >
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8"
            aria-label={searchPlaceholder}
          />
          {searchDraft && (
            <button
              type="button"
              onClick={() => {
                setSearchDraft('');
                onStateChange({ search: '' });
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-3.5" />
            </button>
          )}
        </form>

        {filters}

        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchDraft('');
              onStateChange({ filters: [], search: '' });
            }}
          >
            Limpiar {activeFilters} filtro{activeFilters === 1 ? '' : 's'}
          </Button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {onRefresh && (
            <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Actualizar">
              <RotateCw className={cx('size-4', loading && 'animate-spin')} />
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Columnas visibles">
                <Columns3 className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Columnas</DropdownMenuLabel>
              {visibleByPermission.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={!hidden.has(column.id)}
                  onCheckedChange={(checked) =>
                    setHidden((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(column.id);
                      else next.add(column.id);
                      return next;
                    })
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  {column.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="ghost" size="icon" onClick={exportCsv} aria-label="Exportar a CSV">
            <Download className="size-4" />
          </Button>
        </div>
      </div>

      {/* ── Acciones masivas ── */}
      {selectable && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-3 py-2">
          <span className="text-sm font-medium text-accent-soft-fg">
            {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {bulkActions.map((action) => (
              <Button
                key={action.label}
                size="sm"
                variant={action.destructive ? 'danger' : 'secondary'}
                icon={action.icon}
                onClick={() => void action.onRun(selectedRows)}
              >
                {action.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* ── Contenido ── */}
      {error ? (
        <ErrorState
          description={error.message}
          action={onRefresh && <Button onClick={onRefresh}>Reintentar</Button>}
        />
      ) : loading && rows.length === 0 ? (
        <TableSkeleton columns={visible.length + (selectable ? 1 : 0)} />
      ) : rows.length === 0 ? (
        <Empty
          title={emptyTitle}
          {...(emptyDescription ? { description: emptyDescription } : {})}
          action={emptyAction}
        />
      ) : (
        <>
          {/* Escritorio */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  {selectable && (
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected && !allSelected;
                        }}
                        onChange={toggleAll}
                        aria-label="Seleccionar todo"
                        className="size-4 accent-[var(--color-accent)]"
                      />
                    </th>
                  )}
                  {visible.map((column) => {
                    const sort = state.sort.find((s) => s.field === column.id);
                    return (
                      <th
                        key={column.id}
                        style={column.width ? { width: column.width } : undefined}
                        className={cx(
                          'px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-fg-muted',
                          column.numeric && 'text-right',
                        )}
                        aria-sort={sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        {column.sortable === false ? (
                          column.header
                        ) : (
                          <button
                            type="button"
                            onClick={() => onToggleSort(column.id)}
                            className={cx(
                              'inline-flex items-center gap-1 rounded transition-colors hover:text-fg',
                              column.numeric && 'flex-row-reverse',
                            )}
                          >
                            {column.header}
                            {sort ? (
                              sort.dir === 'asc' ? (
                                <ArrowUp className="size-3" />
                              ) : (
                                <ArrowDown className="size-3" />
                              )
                            ) : null}
                          </button>
                        )}
                      </th>
                    );
                  })}
                  {rowActions.length > 0 && <th className="w-10 px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const id = rowId(row);
                  return (
                    <tr
                      key={id}
                      {...clickableProps(onRowClick ? () => onRowClick(row) : undefined)}
                      className={cx(
                        'border-b border-border last:border-0',
                        onRowClick && 'cursor-pointer',
                        selected.has(id) ? 'bg-accent-soft/40' : 'hover:bg-surface-2',
                      )}
                    >
                      {selectable && (
                        <td className="px-3 py-2" data-row-action>
                          <input
                            type="checkbox"
                            checked={selected.has(id)}
                            onChange={() => toggleRow(id)}
                            aria-label="Seleccionar fila"
                            className="size-4 accent-[var(--color-accent)]"
                          />
                        </td>
                      )}
                      {visible.map((column) => (
                        <td
                          key={column.id}
                          className={cx('px-3 py-2 text-fg', column.numeric && 'numeric text-right')}
                        >
                          {column.cell(row)}
                        </td>
                      ))}
                      {rowActions.length > 0 && (
                        <td className="px-3 py-2" data-row-action>
                          <RowActionsMenu actions={rowActions} row={row} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              {data?.aggregates && aggregateLabels && (
                <tfoot>
                  <tr className="border-t border-border bg-surface-2 font-medium">
                    <td colSpan={visible.length + (selectable ? 1 : 0) + (rowActions.length ? 1 : 0)}>
                      <div className="flex flex-wrap gap-4 px-3 py-2 text-xs">
                        {Object.entries(aggregateLabels).map(([key, label]) => (
                          <span key={key} className="text-fg-muted">
                            {label}:{' '}
                            <span className="tabular text-fg">{String(data.aggregates?.[key] ?? '—')}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Móvil: tarjetas, no una tabla encogida */}
          <ul className="divide-y divide-border md:hidden">
            {rows.map((row) => {
              const id = rowId(row);
              const primary = visible.find((c) => c.primary) ?? visible[0];
              const rest = visible.filter((c) => c !== primary).slice(0, 4);
              return (
                <li key={id}>
                  <div
                    className={cx(
                      'flex items-start gap-3 p-3 outline-none',
                      onRowClick && 'cursor-pointer focus-visible:bg-surface-2',
                    )}
                    {...clickableProps(onRowClick ? () => onRowClick(row) : undefined)}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {primary && <div className="font-medium text-fg">{primary.cell(row)}</div>}
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {rest.map((column) => (
                          <div key={column.id} className="min-w-0">
                            <dt className="truncate text-fg-subtle">{column.header}</dt>
                            <dd className="truncate text-fg">{column.cell(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                    {rowActions.length > 0 && (
                      <span data-row-action>
                        <RowActionsMenu actions={rowActions} row={row} />
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* ── Paginación ── */}
      {data && data.total > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2 text-xs text-fg-muted">
          <div className="flex items-center gap-2">
            <span>Filas</span>
            <Select
              value={state.pageSize}
              onChange={(e) => onStateChange({ pageSize: Number(e.target.value), page: 1 })}
              className="h-7 w-auto py-0 text-xs"
              aria-label="Filas por página"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </div>

          <span className="tabular">
            {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} de{' '}
            {data.total}
          </span>

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={data.page <= 1}
              onClick={() => onStateChange({ page: 1 })}
              aria-label="Primera página"
            >
              <ChevronsLeft className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={data.page <= 1}
              onClick={() => onStateChange({ page: data.page - 1 })}
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="tabular px-2">
              {data.page} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={data.page >= totalPages}
              onClick={() => onStateChange({ page: data.page + 1 })}
              aria-label="Página siguiente"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={data.page >= totalPages}
              onClick={() => onStateChange({ page: totalPages })}
              aria-label="Última página"
            >
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RowActionsMenu<T>({ actions, row }: { actions: RowAction<T>[]; row: T }) {
  const available = actions.filter((a) => !a.hidden?.(row));
  if (available.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Acciones">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {available.map((action, index) => (
          <div key={action.label}>
            {action.destructive && index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              destructive={action.destructive ?? false}
              onSelect={() => void action.onRun(row)}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 6 }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }, (_, colIndex) => (
            <Skeleton key={colIndex} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
