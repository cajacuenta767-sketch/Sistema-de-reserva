import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Contact, Handshake, Plus, Trash2, Upload, Users } from 'lucide-react';
import { Badge, Button, PageHeader, Select, StatTile } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useCollection, useList, useResource } from '@/lib/api/useList';
import { del } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { relative } from '@/lib/format';
import { PartyDialog } from '../components/PartyDialog';
import { documentLabel } from '../lib/party';

export interface PartyRow {
  id: string;
  display_name: string;
  legal_name: string | null;
  tax_id_type: string;
  tax_id: string | null;
  tax_id_dv: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  is_customer: boolean;
  is_vendor: boolean;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  owner_name: string | null;
  tags: string[];
  contact_count: number;
  created_at: string;
}

interface Tag {
  id: string;
  name: string;
  colorHue: number | null;
}

interface PartyOverview {
  total: number;
  customers: number;
  vendors: number;
  active: number;
  inactive: number;
  contacts: number;
  contactsToday: number;
  contactsLast7Days: number;
}

const STATUS_TONE = { ACTIVE: 'success', INACTIVE: 'neutral', BLOCKED: 'danger' } as const;
const STATUS_LABEL = { ACTIVE: 'Activo', INACTIVE: 'Inactivo', BLOCKED: 'Bloqueado' };

export function PartiesPage() {
  const table = useTableState({ defaultSort: [{ field: 'display_name', dir: 'asc' }] });
  const can = useCan();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // `?nuevo=1` abre el diálogo: es lo que hace que el comando "Nuevo cliente"
  // de la paleta ⌘K llegue al formulario y no solo al listado.
  const [params, setParams] = useSearchParams();
  const creating = params.get('nuevo') === '1';
  const setCreating = (open: boolean) => {
    const next = new URLSearchParams(params);
    if (open) next.set('nuevo', '1');
    else next.delete('nuevo');
    setParams(next, { replace: true });
  };

  const query = useList<PartyRow>('/parties', table.toQuery());
  const overview = useResource<PartyOverview>('/parties/overview');
  const tags = useCollection<Tag>('/tags');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['/parties'] });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/parties/${id}`),
    onSuccess: () => {
      toast.success('Ficha archivada');
      invalidate();
    },
    onError: toast.error,
  });

  const columns = useMemo<Column<PartyRow>[]>(
    () => [
      {
        id: 'display_name',
        header: 'Nombre',
        primary: true,
        sortable: true,
        cell: (row) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.display_name}</div>
            {row.legal_name && row.legal_name !== row.display_name && (
              <div className="truncate text-xs text-fg-subtle">{row.legal_name}</div>
            )}
          </div>
        ),
      },
      {
        id: 'tax_id',
        header: 'Documento',
        sortable: true,
        cell: (row) => documentLabel(row.tax_id_type, row.tax_id, row.tax_id_dv),
      },
      {
        id: 'roles',
        header: 'Rol',
        sortable: false,
        cell: (row) => (
          <div className="flex flex-wrap gap-1">
            {row.is_customer && <Badge tone="accent">Cliente</Badge>}
            {row.is_vendor && <Badge tone="info">Proveedor</Badge>}
          </div>
        ),
      },
      { id: 'email', header: 'Correo', sortable: true, cell: (row) => row.email ?? '—' },
      { id: 'phone', header: 'Teléfono', sortable: false, cell: (row) => row.phone ?? '—' },
      { id: 'city', header: 'Ciudad', sortable: true, cell: (row) => row.city ?? '—' },
      {
        id: 'tags',
        header: 'Etiquetas',
        sortable: false,
        cell: (row) =>
          row.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.tags.map((name) => (
                <Badge key={name}>{name}</Badge>
              ))}
            </div>
          ) : (
            <span className="text-fg-subtle">—</span>
          ),
      },
      {
        id: 'contact_count',
        header: 'Contactos',
        numeric: true,
        sortable: false,
        cell: (row) => row.contact_count || '—',
      },
      {
        id: 'status',
        header: 'Estado',
        sortable: true,
        cell: (row) => (
          <Badge tone={STATUS_TONE[row.status]} dot>
            {STATUS_LABEL[row.status]}
          </Badge>
        ),
      },
      {
        id: 'owner_membership_id',
        header: 'Responsable',
        sortable: false,
        hiddenByDefault: true,
        cell: (row) => row.owner_name ?? '—',
      },
      {
        id: 'created_at',
        header: 'Alta',
        sortable: true,
        hiddenByDefault: true,
        cell: (row) => relative(row.created_at),
      },
    ],
    [],
  );

  const filterValue = (field: string): string =>
    (table.state.filters.find((f) => f.field === field)?.value as string | undefined) ?? '';

  return (
    <>
      <PageHeader
        title="Clientes y proveedores"
        description="Una sola ficha por empresa, con los roles que desempeñe"
        actions={
          <div className="flex flex-wrap gap-2">
            <Can perm="platform:import:create">
              <Button
                variant="secondary"
                icon={<Upload className="size-4" />}
                onClick={() => navigate('/importaciones?entidad=party')}
              >
                Importar
              </Button>
            </Can>
            <Can perm="crm:party:create">
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Nueva ficha
              </Button>
            </Can>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Clientes"
          value={overview.data?.customers ?? '—'}
          icon={<Users className="size-5" />}
          tone="accent"
        />
        <StatTile
          label="Proveedores"
          value={overview.data?.vendors ?? '—'}
          icon={<Handshake className="size-5" />}
          tone="info"
        />
        <StatTile
          label="Contactos"
          value={overview.data?.contacts ?? '—'}
          icon={<Contact className="size-5" />}
        />
        <StatTile
          label="Fichas activas"
          value={overview.data?.active ?? '—'}
          icon={<Building2 className="size-5" />}
          tone="success"
        />
      </div>

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
        onRowClick={(row) => navigate(`/clientes/${row.id}`)}
        can={can}
        searchPlaceholder="Buscar por nombre, NIT, correo o teléfono…"
        emptyTitle="Todavía no hay fichas"
        emptyDescription="Crea la primera o importa tu cartera desde un archivo."
        aggregateLabels={{ customers: 'Clientes', vendors: 'Proveedores', active: 'Activos' }}
        filters={
          <>
            <Select
              value={filterValue('is_customer')}
              onChange={(e) => table.setFilter('is_customer', 'eq', e.target.value || null)}
              className="h-9 w-auto"
              aria-label="Filtrar por rol"
            >
              <option value="">Clientes y proveedores</option>
              <option value="true">Solo clientes</option>
            </Select>
            <Select
              value={filterValue('is_vendor')}
              onChange={(e) => table.setFilter('is_vendor', 'eq', e.target.value || null)}
              className="h-9 w-auto"
              aria-label="Filtrar proveedores"
            >
              <option value="">Todos</option>
              <option value="true">Solo proveedores</option>
            </Select>
            <Select
              value={filterValue('status')}
              onChange={(e) => table.setFilter('status', 'eq', e.target.value || null)}
              className="h-9 w-auto"
              aria-label="Filtrar por estado"
            >
              <option value="">Cualquier estado</option>
              <option value="ACTIVE">Activos</option>
              <option value="INACTIVE">Inactivos</option>
              <option value="BLOCKED">Bloqueados</option>
            </Select>
            {tags.data && tags.data.items.length > 0 && (
              <Select
                value={filterValue('tag')}
                onChange={(e) => table.setFilter('tag', 'eq', e.target.value || null)}
                className="h-9 w-auto"
                aria-label="Filtrar por etiqueta"
              >
                <option value="">Cualquier etiqueta</option>
                {tags.data.items.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            )}
          </>
        }
        rowActions={[
          {
            label: 'Archivar',
            icon: <Trash2 className="size-4" />,
            destructive: true,
            hidden: () => !can('crm:party:delete'),
            onRun: (row) => remove.mutate(row.id),
          },
        ]}
      />

      {creating && (
        <PartyDialog
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            invalidate();
            navigate(`/clientes/${id}`);
          }}
        />
      )}
    </>
  );
}
