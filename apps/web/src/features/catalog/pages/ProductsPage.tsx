import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Boxes, Package, Plus, Trash2, Upload, Wrench } from 'lucide-react';
import { Badge, Button, PageHeader, Select, StatTile } from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useCollection, useList, useResource } from '@/lib/api/useList';
import { del } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { money, relative } from '@/lib/format';
import { ProductDialog } from '../components/ProductDialog';
import { productKindLabel, rateLabel } from '../lib/labels';
import type { Category, ProductOverview } from '../lib/types';

interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  kind: 'GOOD' | 'SERVICE' | 'KIT';
  category_path: string | null;
  uom_code: string;
  sale_price: string;
  purchase_price: string;
  currency_code: string;
  sale_tax_code: string | null;
  sale_tax_rate: string | null;
  track_inventory: boolean;
  is_active: boolean;
  variant_count: number;
  created_at: string;
}

const KIND_TONE = { GOOD: 'accent', SERVICE: 'info', KIT: 'warning' } as const;

export function ProductsPage() {
  const table = useTableState({ defaultSort: [{ field: 'name', dir: 'asc' }] });
  const can = useCan();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [params, setParams] = useSearchParams();
  const creating = params.get('nuevo') === '1';
  const setCreating = (open: boolean) => {
    const next = new URLSearchParams(params);
    if (open) next.set('nuevo', '1');
    else next.delete('nuevo');
    setParams(next, { replace: true });
  };

  const query = useList<ProductRow>('/products', table.toQuery());
  const overview = useResource<ProductOverview>('/products/overview');
  const categories = useCollection<Category>('/product-categories');

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['/products'] });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/products/${id}`),
    onSuccess: () => {
      toast.success('Producto archivado');
      invalidate();
    },
    onError: toast.error,
  });

  const columns = useMemo<Column<ProductRow>[]>(
    () => [
      { id: 'sku', header: 'Código', sortable: true, cell: (row) => <span className="font-mono text-xs">{row.sku}</span> },
      {
        id: 'name',
        header: 'Producto',
        primary: true,
        sortable: true,
        cell: (row) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.name}</div>
            {row.category_path && <div className="truncate text-xs text-fg-subtle">{row.category_path}</div>}
          </div>
        ),
      },
      {
        id: 'kind',
        header: 'Tipo',
        sortable: true,
        cell: (row) => <Badge tone={KIND_TONE[row.kind]}>{productKindLabel(row.kind)}</Badge>,
      },
      {
        id: 'sale_price',
        header: 'Precio',
        numeric: true,
        sortable: true,
        cell: (row) => money(row.sale_price, row.currency_code),
      },
      {
        id: 'purchase_price',
        header: 'Costo',
        numeric: true,
        sortable: true,
        // El costo es información sensible: quien no puede comprar no ve el margen.
        permission: 'catalog:product:update',
        cell: (row) => money(row.purchase_price, row.currency_code),
      },
      {
        id: 'sale_tax_id',
        header: 'Impuesto',
        sortable: false,
        cell: (row) => (row.sale_tax_code ? `${row.sale_tax_code} · ${rateLabel(row.sale_tax_rate ?? '0')}` : '—'),
      },
      { id: 'uom_id', header: 'Unidad', sortable: false, cell: (row) => row.uom_code },
      {
        id: 'variant_count',
        header: 'Variantes',
        numeric: true,
        sortable: false,
        hiddenByDefault: true,
        cell: (row) => row.variant_count || '—',
      },
      {
        id: 'barcode',
        header: 'Código de barras',
        sortable: false,
        hiddenByDefault: true,
        cell: (row) => row.barcode ?? '—',
      },
      {
        id: 'is_active',
        header: 'Estado',
        sortable: true,
        cell: (row) => (
          <Badge tone={row.is_active ? 'success' : 'neutral'} dot>
            {row.is_active ? 'Activo' : 'Inactivo'}
          </Badge>
        ),
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
        title="Productos y servicios"
        description="Lo que vendes y lo que compras, con su impuesto y su unidad"
        actions={
          <div className="flex flex-wrap gap-2">
            <Can perm="platform:import:create">
              <Button
                variant="secondary"
                icon={<Upload className="size-4" />}
                onClick={() => navigate('/importaciones?entidad=product')}
              >
                Importar
              </Button>
            </Can>
            <Can perm="catalog:product:create">
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                Nuevo producto
              </Button>
            </Can>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Bienes" value={overview.data?.goods ?? '—'} icon={<Package className="size-5" />} tone="accent" />
        <StatTile label="Servicios" value={overview.data?.services ?? '—'} icon={<Wrench className="size-5" />} tone="info" />
        <StatTile label="Sin precio" value={overview.data?.withoutPrice ?? '—'} icon={<Boxes className="size-5" />} tone="warning" />
        <StatTile
          label="Bajo costo"
          hint="Se venden por debajo de lo que cuestan"
          value={overview.data?.belowCost ?? '—'}
          icon={<AlertTriangle className="size-5" />}
          tone={overview.data && overview.data.belowCost > 0 ? 'danger' : 'success'}
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
        onRowClick={(row) => navigate(`/productos/${row.id}`)}
        can={can}
        searchPlaceholder="Buscar por nombre, código o código de barras…"
        emptyTitle="El catálogo está vacío"
        emptyDescription="Crea el primer producto o importa tu lista desde un archivo."
        aggregateLabels={{ active: 'Activos', goods: 'Bienes', services: 'Servicios' }}
        filters={
          <>
            <Select
              value={filterValue('kind')}
              onChange={(e) => table.setFilter('kind', 'eq', e.target.value || null)}
              className="h-9 w-auto"
              aria-label="Filtrar por tipo"
            >
              <option value="">Todos los tipos</option>
              <option value="GOOD">Bienes</option>
              <option value="SERVICE">Servicios</option>
              <option value="KIT">Kits</option>
            </Select>
            <Select
              value={filterValue('category_id')}
              onChange={(e) => table.setFilter('category_id', 'eq', e.target.value || null)}
              className="h-9 w-auto"
              aria-label="Filtrar por categoría"
            >
              <option value="">Todas las categorías</option>
              {categories.data?.items.map((category) => (
                <option key={category.id} value={category.id}>
                  {'— '.repeat(category.depth)}
                  {category.name}
                </option>
              ))}
            </Select>
            <Select
              value={filterValue('is_active')}
              onChange={(e) => table.setFilter('is_active', 'eq', e.target.value || null)}
              className="h-9 w-auto"
              aria-label="Filtrar por estado"
            >
              <option value="">Activos e inactivos</option>
              <option value="true">Solo activos</option>
              <option value="false">Solo inactivos</option>
            </Select>
          </>
        }
        rowActions={[
          {
            label: 'Archivar',
            icon: <Trash2 className="size-4" />,
            destructive: true,
            hidden: () => !can('catalog:product:delete'),
            onRun: (row) => remove.mutate(row.id),
          },
        ]}
      />

      {creating && (
        <ProductDialog
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            invalidate();
            navigate(`/productos/${id}`);
          }}
        />
      )}
    </>
  );
}
