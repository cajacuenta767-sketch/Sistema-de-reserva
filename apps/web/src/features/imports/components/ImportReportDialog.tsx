import { CheckCircle2, XCircle } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, Spinner, StatTile } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useList, useResource } from '@/lib/api/useList';
import { useCan } from '@/lib/authz/useCan';
import type { ImportPreview, ImportRowResult } from '../lib/types';

/**
 * Informe fila a fila de una importación.
 *
 * Es la pantalla que hace útil el resto: la lista de lo que NO entró, con el
 * número de línea del archivo y el motivo en castellano, para corregir el
 * archivo y volver a subirlo. Un resumen con "487 de 500" obliga a buscar las
 * trece a mano.
 */
export function ImportReportDialog({ importId, onClose }: { importId: string; onClose: () => void }) {
  const table = useTableState({ defaultSort: [{ field: 'row_no', dir: 'asc' }] });
  const can = useCan();

  const job = useResource<ImportPreview>(`/imports/${importId}`);
  const rows = useList<ImportRowResult>(`/imports/${importId}/rows`, table.toQuery());

  const columns: Column<ImportRowResult>[] = [
    {
      id: 'row_no',
      header: 'Fila',
      numeric: true,
      sortable: true,
      width: '5rem',
      // La numeración coincide con la de Excel: la 1 es la cabecera.
      cell: (row) => row.row_no,
    },
    {
      id: 'status',
      header: 'Resultado',
      sortable: true,
      primary: true,
      cell: (row) =>
        row.status === 'OK' ? (
          <span className="inline-flex items-center gap-1.5 text-success-fg">
            <CheckCircle2 className="size-4" /> Importada
          </span>
        ) : row.status === 'ERROR' ? (
          <span className="inline-flex items-center gap-1.5 text-danger-fg">
            <XCircle className="size-4" /> Con error
          </span>
        ) : (
          <Badge tone="neutral">Pendiente</Badge>
        ),
    },
    {
      id: 'error',
      header: 'Motivo',
      sortable: false,
      cell: (row) => row.error ?? <span className="text-fg-subtle">—</span>,
    },
    {
      id: 'raw',
      header: 'Datos del archivo',
      sortable: false,
      cell: (row) => (
        <span className="text-fg-muted">
          {Object.values(row.raw)
            .filter(Boolean)
            .slice(0, 3)
            .join(' · ')}
        </span>
      ),
    },
  ];

  const aggregates = rows.data?.aggregates;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={job.data ? `Resultado de «${job.data.job.filename}»` : 'Resultado de la importación'}
        size="xl"
        footer={<Button onClick={onClose}>Cerrar</Button>}
      >
        {job.isLoading && <Spinner />}

        {job.data && (
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Filas del archivo" value={job.data.job.totalRows} />
            <StatTile label="Importadas" value={aggregates?.ok ?? job.data.job.okRows} tone="success" />
            <StatTile
              label="Con error"
              value={aggregates?.errors ?? job.data.job.errorRows}
              tone={job.data.job.errorRows > 0 ? 'danger' : 'success'}
            />
          </div>
        )}

        <DataTable
          columns={columns}
          data={rows.data}
          state={table.state}
          onStateChange={table.update}
          onToggleSort={table.toggleSort}
          rowId={(row) => String(row.row_no)}
          loading={rows.isFetching}
          error={rows.error as Error | null}
          onRefresh={() => void rows.refetch()}
          can={can}
          searchPlaceholder="Buscar en los motivos de error…"
          emptyTitle="Sin filas"
          filters={
            <Button
              size="sm"
              variant={
                table.state.filters.some((f) => f.field === 'status' && f.value === 'ERROR')
                  ? 'primary'
                  : 'secondary'
              }
              onClick={() =>
                table.setFilter(
                  'status',
                  'eq',
                  table.state.filters.some((f) => f.field === 'status' && f.value === 'ERROR') ? null : 'ERROR',
                )
              }
            >
              Solo las que fallaron
            </Button>
          }
        />
      </DialogContent>
    </Dialog>
  );
}
