import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, FileUp, Upload, XCircle } from 'lucide-react';
import { Badge, Button, PageHeader, Select } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useCollection, useList } from '@/lib/api/useList';
import { Can, useCan } from '@/lib/authz/useCan';
import { relative } from '@/lib/format';
import { ImportWizard } from '../components/ImportWizard';
import { ImportReportDialog } from '../components/ImportReportDialog';
import type { ImportJobRow, ImportType } from '../lib/types';

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  PENDING: { label: 'Pendiente', tone: 'neutral' },
  VALIDATING: { label: 'Validando', tone: 'info' },
  READY: { label: 'Lista para ejecutar', tone: 'warning' },
  RUNNING: { label: 'En curso', tone: 'info' },
  DONE: { label: 'Terminada', tone: 'success' },
  FAILED: { label: 'Fallida', tone: 'danger' },
};

export function ImportsPage() {
  const table = useTableState({ defaultSort: [{ field: 'created_at', dir: 'desc' }] });
  const can = useCan();
  const queryClient = useQueryClient();

  // `?entidad=party` abre el asistente ya apuntando a esa entidad: es el enlace
  // que traen los botones "Importar" de clientes y de productos.
  const [params, setParams] = useSearchParams();
  const startWith = params.get('entidad');
  const [wizard, setWizard] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const query = useList<ImportJobRow>('/imports', table.toQuery());
  const types = useCollection<ImportType>('/imports/catalog');

  const openWizard = (entityType: string | null) => {
    setWizard(entityType);
    if (startWith) {
      const next = new URLSearchParams(params);
      next.delete('entidad');
      setParams(next, { replace: true });
    }
  };

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['/imports'] });

  const columns = useMemo<Column<ImportJobRow>[]>(
    () => [
      {
        id: 'filename',
        header: 'Archivo',
        primary: true,
        sortable: true,
        cell: (row) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.filename}</div>
            <div className="text-xs text-fg-subtle">{row.entity_type === 'party' ? 'Clientes' : 'Productos'}</div>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Estado',
        sortable: true,
        cell: (row) => {
          const status = STATUS[row.status] ?? { label: row.status, tone: 'neutral' as const };
          return (
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          );
        },
      },
      { id: 'total_rows', header: 'Filas', numeric: true, sortable: false, cell: (row) => row.total_rows },
      {
        id: 'ok_rows',
        header: 'Importadas',
        numeric: true,
        sortable: false,
        cell: (row) => (
          <span className="inline-flex items-center gap-1 text-success-fg">
            <CheckCircle2 className="size-4" />
            {row.ok_rows}
          </span>
        ),
      },
      {
        id: 'error_rows',
        header: 'Con error',
        numeric: true,
        sortable: false,
        cell: (row) =>
          row.error_rows > 0 ? (
            <span className="inline-flex items-center gap-1 text-danger-fg">
              <XCircle className="size-4" />
              {row.error_rows}
            </span>
          ) : (
            '—'
          ),
      },
      {
        id: 'created_by_name',
        header: 'Quién',
        sortable: false,
        hiddenByDefault: true,
        cell: (row) => row.created_by_name ?? '—',
      },
      { id: 'created_at', header: 'Cuándo', sortable: true, cell: (row) => relative(row.created_at) },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Importaciones"
        description="Trae clientes o productos desde un archivo CSV, revisando fila a fila lo que entra"
        actions={
          <Can perm="platform:import:create">
            <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => openWizard(startWith)}>
              Importar archivo
            </Button>
          </Can>
        }
      />

      <DataTable
        columns={columns}
        data={query.data}
        state={table.state}
        onStateChange={table.update}
        onToggleSort={table.toggleSort}
        rowId={(row) => row.id}
        loading={query.isFetching}
        error={query.error as Error | null}
        onRefresh={() => void query.refetch()}
        onRowClick={(row) => setReport(row.id)}
        can={can}
        searchPlaceholder="Buscar por nombre de archivo…"
        emptyTitle="Todavía no has importado nada"
        emptyDescription="Sube un CSV con tus clientes o tu catálogo y revísalo antes de crear nada."
        emptyAction={
          <Can perm="platform:import:create">
            <Button variant="primary" icon={<FileUp className="size-4" />} onClick={() => openWizard(null)}>
              Importar archivo
            </Button>
          </Can>
        }
        filters={
          <Select
            value={(table.state.filters.find((f) => f.field === 'entity_type')?.value as string | undefined) ?? ''}
            onChange={(e) => table.setFilter('entity_type', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por tipo"
          >
            <option value="">Todo</option>
            {types.data?.items.map((type) => (
              <option key={type.entityType} value={type.entityType}>
                {type.label}
              </option>
            ))}
          </Select>
        }
      />

      {(wizard !== null || startWith) && (
        <ImportWizard
          entityType={wizard ?? startWith ?? undefined}
          onClose={() => openWizard(null)}
          onFinished={(importId) => {
            openWizard(null);
            invalidate();
            setReport(importId);
          }}
        />
      )}

      {report && <ImportReportDialog importId={report} onClose={() => setReport(null)} />}
    </>
  );
}
