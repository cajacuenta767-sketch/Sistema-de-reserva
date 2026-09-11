import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  PageHeader,
  PageLoader,
  StatTile,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/design-system';
import { useResource } from '@/lib/api/useList';
import { del } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { amount, date, money, percent } from '@/lib/format';
import { ProductDialog } from '../components/ProductDialog';
import { VariantDialog } from '../components/VariantDialog';
import { ProductPricesPanel } from '../components/ProductPricesPanel';
import { costMethodLabel, productKindLabel, rateLabel, trackingLabel } from '../lib/labels';
import type { ProductDetail } from '../lib/types';

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const can = useCan();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [addingVariant, setAddingVariant] = useState(false);

  const [params, setParams] = useSearchParams();
  const tab = params.get('pestana') ?? 'resumen';

  const query = useResource<ProductDetail>(`/products/${id}`);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: [`/products/${id}`] });

  const removeVariant = useMutation({
    mutationFn: (variantId: string) => del(`/variants/${variantId}`),
    onSuccess: () => {
      toast.success('Variante eliminada');
      invalidate();
    },
    onError: toast.error,
  });

  if (query.isLoading) return <PageLoader />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        title="No se pudo cargar el producto"
        description={(query.error as Error | null)?.message}
        action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
      />
    );
  }

  const { product, variants, uom, categoryPath, saleTax, purchaseTax, marginPercent } = query.data;
  const margin = marginPercent === null ? null : Number(marginPercent);

  return (
    <>
      <PageHeader
        title={product.name}
        description={`${product.sku}${categoryPath ? ` · ${categoryPath}` : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/productos')}>
              Volver
            </Button>
            <Can perm="catalog:product:update">
              <Button variant="primary" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Editar
              </Button>
            </Can>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{productKindLabel(product.kind)}</Badge>
        <Badge tone={product.isActive ? 'success' : 'neutral'} dot>
          {product.isActive ? 'Activo' : 'Inactivo'}
        </Badge>
        {product.trackInventory && <Badge tone="info">Con existencias</Badge>}
        {product.tracking !== 'NONE' && <Badge>{trackingLabel(product.tracking)}</Badge>}
        {product.priceIncludesTax && <Badge tone="warning">Precio con impuestos</Badge>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Precio de venta" value={money(product.salePrice, product.currencyCode)} tone="accent" />
        {can('catalog:product:update') && (
          <>
            <StatTile label="Precio de compra" value={money(product.purchasePrice, product.currencyCode)} />
            <StatTile
              label="Margen"
              // Formateado en es-CO: el backend devuelve "28.89" y escrito tal
              // cual, con punto, en Colombia se lee "veintiocho mil".
              value={margin === null ? '—' : percent(margin, 2)}
              // Vender bajo costo es el dato que hay que ver de un vistazo.
              tone={margin === null ? undefined : margin < 0 ? 'danger' : margin < 15 ? 'warning' : 'success'}
              hint={margin !== null && margin < 0 ? 'Se vende por debajo del costo' : undefined}
            />
          </>
        )}
        <StatTile label="Impuesto" value={saleTax ? rateLabel(saleTax.rate, saleTax.kind) : '—'} hint={saleTax?.name} />
      </div>

      <Tabs value={tab} onValueChange={(value) => setParams({ pestana: value }, { replace: true })} className="mt-2">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="variantes">
            Variantes
            {variants.length > 0 && <span className="ml-1.5 text-xs text-fg-subtle">{variants.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="precios">Precios</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card space-y-3 p-4">
              <h2 className="text-sm font-semibold">Ficha</h2>
              <dl className="space-y-2 text-sm">
                <Line label="Código" value={product.sku} />
                <Line label="Código de barras" value={product.barcode} />
                <Line label="Marca" value={product.brand} />
                <Line label="Categoría" value={categoryPath} />
                <Line label="Unidad" value={uom ? `${uom.code} · ${uom.name}` : null} />
                <Line label="Alta" value={date(product.createdAt)} />
              </dl>
            </section>

            <section className="card space-y-3 p-4">
              <h2 className="text-sm font-semibold">Impuestos e inventario</h2>
              <dl className="space-y-2 text-sm">
                <Line label="Impuesto de venta" value={saleTax ? `${saleTax.name} (${rateLabel(saleTax.rate, saleTax.kind)})` : null} />
                <Line
                  label="Impuesto de compra"
                  value={purchaseTax ? `${purchaseTax.name} (${rateLabel(purchaseTax.rate, purchaseTax.kind)})` : null}
                />
                <Line label="Método de costo" value={costMethodLabel(product.costMethod)} />
                <Line label="Trazabilidad" value={trackingLabel(product.tracking)} />
                <Line label="Existencias mínimas" value={product.minStock ? amount(product.minStock, 2) : null} />
              </dl>
            </section>

            {product.description && (
              <section className="card space-y-2 p-4 lg:col-span-2">
                <h2 className="text-sm font-semibold">Descripción</h2>
                <p className="text-sm whitespace-pre-wrap text-fg-muted">{product.description}</p>
              </section>
            )}
          </div>
        </TabsContent>

        <TabsContent value="variantes">
          <div className="space-y-3">
            <div className="flex justify-end">
              <Can perm="catalog:product:update">
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAddingVariant(true)}>
                  Añadir variante
                </Button>
              </Can>
            </div>

            {variants.length === 0 ? (
              <Empty
                title="Sin variantes"
                description="Úsalas cuando el mismo producto se venda en varias tallas, colores o presentaciones."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {variants.map((variant) => (
                  <li key={variant.id} className="card flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{variant.name}</div>
                      <div className="font-mono text-xs text-fg-subtle">{variant.sku}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(variant.attributes).map(([key, value]) => (
                          <Badge key={key}>
                            {key}: {value}
                          </Badge>
                        ))}
                      </div>
                      {Number(variant.priceDelta) !== 0 && (
                        <p className="mt-1 text-sm text-fg-muted">
                          {Number(variant.priceDelta) > 0 ? '+' : ''}
                          {money(variant.priceDelta, product.currencyCode)} sobre el precio base
                        </p>
                      )}
                    </div>
                    {can('catalog:product:update') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 className="size-4" />}
                        aria-label={`Eliminar ${variant.name}`}
                        onClick={() => removeVariant.mutate(variant.id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="precios">
          <ProductPricesPanel product={product} />
        </TabsContent>
      </Tabs>

      {editing && (
        <ProductDialog
          productId={product.id}
          initial={{
            name: product.name,
            sku: product.sku,
            barcode: product.barcode ?? '',
            description: product.description ?? '',
            kind: product.kind,
            categoryId: product.categoryId ?? '',
            uomId: product.uomId,
            salePrice: product.salePrice,
            purchasePrice: product.purchasePrice,
            saleTaxId: product.saleTaxId ?? '',
            priceIncludesTax: product.priceIncludesTax,
            trackInventory: product.trackInventory,
            tracking: product.tracking,
            brand: product.brand ?? '',
            minStock: product.minStock ?? '',
            isSellable: product.isSellable,
            isPurchasable: product.isPurchasable,
            isActive: product.isActive,
          }}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            invalidate();
          }}
        />
      )}

      {addingVariant && (
        <VariantDialog
          productId={product.id}
          onClose={() => setAddingVariant(false)}
          onSaved={() => {
            setAddingVariant(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}

function Line({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-40 shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{value ?? <span className="text-fg-subtle">—</span>}</dd>
    </div>
  );
}
