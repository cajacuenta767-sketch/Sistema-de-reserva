import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { Badge, Dialog, DialogContent, PageHeader, Select, type Tone } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useList } from '@/lib/api/useList';
import { dateTime } from '@/lib/format';

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  changed_fields: string[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  occurred_at: string;
  actor: string | null;
  request_id: string | null;
}

const ACTION_TONE: Record<string, Tone> = {
  CREATE: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
  POST: 'accent',
  VOID: 'warning',
  LOGIN: 'neutral',
  EXPORT: 'neutral',
};

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'Creó',
  UPDATE: 'Editó',
  DELETE: 'Eliminó',
  POST: 'Contabilizó',
  VOID: 'Anuló',
  LOGIN: 'Entró',
  EXPORT: 'Exportó',
};

const ENTITY_LABEL: Record<string, string> = {
  organization: 'Empresa',
  branch: 'Sucursal',
  role: 'Rol',
  role_permissions: 'Permisos del rol',
  membership: 'Membresía',
  membership_roles: 'Roles de la persona',
  permission_override: 'Excepción de permiso',
  invitation: 'Invitación',
  team: 'Equipo',
  session: 'Sesión',
  organization_setting: 'Configuración',
};

export function AuditPage() {
  const table = useTableState({ defaultSort: [{ field: 'occurred_at', dir: 'desc' }] });
  const query = useList<AuditRow>('/audit', table.toQuery());
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const columns = useMemo<Column<AuditRow>[]>(
    () => [
      {
        id: 'occurred_at',
        header: 'Cuándo',
        sortable: true,
        width: '180px',
        cell: (row) => dateTime(row.occurred_at),
      },
      { id: 'actor', header: 'Quién', sortable: true, cell: (row) => row.actor ?? 'Sistema' },
      {
        id: 'action',
        header: 'Qué',
        sortable: true,
        cell: (row) => (
          <Badge tone={ACTION_TONE[row.action] ?? 'neutral'}>{ACTION_LABEL[row.action] ?? row.action}</Badge>
        ),
      },
      {
        id: 'entity_label',
        header: 'Sobre',
        primary: true,
        sortable: true,
        cell: (row) => (
          <span>
            <span className="text-fg-subtle">{ENTITY_LABEL[row.entity_type] ?? row.entity_type}</span>
            {row.entity_label && <span className="ml-1.5 font-medium">{row.entity_label}</span>}
          </span>
        ),
      },
      {
        id: 'changed_fields',
        header: 'Campos',
        sortable: false,
        cell: (row) =>
          row.changed_fields.length > 0 ? (
            <span className="text-xs text-fg-muted">{row.changed_fields.join(', ')}</span>
          ) : (
            '—'
          ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Todo cambio queda registrado y no se puede editar ni borrar"
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
        onRowClick={setDetail}
        searchPlaceholder="Buscar por quién o sobre qué…"
        emptyTitle="Sin actividad registrada"
        emptyDescription="Aquí aparecerá cada cambio en cuanto ocurra."
        filters={
          <Select
            value={(table.state.filters.find((f) => f.field === 'action')?.value as string) ?? ''}
            onChange={(e) => table.setFilter('action', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por acción"
          >
            <option value="">Todas las acciones</option>
            {Object.entries(ACTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        }
      />

      <Dialog open={detail !== null} onOpenChange={(v) => !v && setDetail(null)}>
        {detail && (
          <DialogContent
            title={`${ACTION_LABEL[detail.action] ?? detail.action} · ${ENTITY_LABEL[detail.entity_type] ?? detail.entity_type}`}
            description={`${detail.actor ?? 'Sistema'} · ${dateTime(detail.occurred_at)}`}
            size="lg"
          >
            <div className="space-y-4">
              {detail.changed_fields.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-fg-muted">
                      <th className="py-1.5 pr-3">Campo</th>
                      <th className="py-1.5 pr-3">Antes</th>
                      <th className="py-1.5">Después</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.changed_fields.map((field) => (
                      <tr key={field} className="border-b border-border last:border-0 align-top">
                        <td className="py-1.5 pr-3 font-mono text-xs text-fg-muted">{field}</td>
                        <td className="py-1.5 pr-3 text-danger-fg">{formatValue(detail.before?.[field])}</td>
                        <td className="py-1.5 text-success-fg">{formatValue(detail.after?.[field])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <History className="size-4" />
                  Sin cambios de campo que mostrar.
                </div>
              )}

              {detail.request_id && (
                <p className="font-mono text-[11px] text-fg-subtle">Petición: {detail.request_id}</p>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};
