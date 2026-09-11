import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, Field, Input, Select, Textarea } from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { patch, post } from '@/lib/api/client';
import { useToast } from '@/store/toast';
import { PRODUCT_KINDS, TRACKING_MODES, rateLabel } from '../lib/labels';
import type { Category, Tax, Uom } from '../lib/types';

export interface ProductFormValues {
  name: string;
  sku: string;
  barcode: string;
  description: string;
  kind: 'GOOD' | 'SERVICE' | 'KIT';
  categoryId: string;
  uomId: string;
  salePrice: string;
  purchasePrice: string;
  saleTaxId: string;
  priceIncludesTax: boolean;
  trackInventory: boolean;
  tracking: 'NONE' | 'LOT' | 'SERIAL';
  brand: string;
  minStock: string;
  isSellable: boolean;
  isPurchasable: boolean;
  isActive: boolean;
}

const EMPTY: ProductFormValues = {
  name: '',
  sku: '',
  barcode: '',
  description: '',
  kind: 'GOOD',
  categoryId: '',
  uomId: '',
  salePrice: '',
  purchasePrice: '',
  saleTaxId: '',
  priceIncludesTax: false,
  trackInventory: true,
  tracking: 'NONE',
  brand: '',
  minStock: '',
  isSellable: true,
  isPurchasable: true,
  isActive: true,
};

interface Props {
  productId?: string;
  initial?: Partial<ProductFormValues>;
  onClose: () => void;
  onSaved: (id: string) => void;
}

export function ProductDialog({ productId, initial, onClose, onSaved }: Props) {
  const toast = useToast();
  const [values, setValues] = useState<ProductFormValues>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const uoms = useCollection<Uom>('/uoms');
  const taxes = useCollection<Tax>('/taxes');
  const categories = useCollection<Category>('/product-categories');

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  // Un servicio nunca lleva existencias: el backend lo rechaza, así que la
  // casilla se desactiva sola en vez de dejar armar un formulario imposible.
  const isService = values.kind === 'SERVICE';

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: values.name.trim(),
        sku: blank(values.sku),
        barcode: blank(values.barcode),
        description: blank(values.description),
        kind: values.kind,
        categoryId: values.categoryId || null,
        uomId: values.uomId || null,
        salePrice: numeric(values.salePrice),
        purchasePrice: numeric(values.purchasePrice),
        saleTaxId: values.saleTaxId || null,
        priceIncludesTax: values.priceIncludesTax,
        trackInventory: isService ? false : values.trackInventory,
        tracking: isService || !values.trackInventory ? 'NONE' : values.tracking,
        brand: blank(values.brand),
        minStock: values.minStock ? numeric(values.minStock) : null,
        isSellable: values.isSellable,
        isPurchasable: values.isPurchasable,
        isActive: values.isActive,
      };
      return productId
        ? patch<{ id: string }>(`/products/${productId}`, body)
        : post<{ id: string }>('/products', body);
    },
    onSuccess: (product) => {
      toast.success(productId ? 'Producto actualizado' : 'Producto creado');
      onSaved(product.id);
    },
    onError: (error: Error) => {
      if (/código/i.test(error.message)) setErrors({ sku: error.message });
      toast.error(error);
    },
  });

  const submit = () => {
    if (!values.name.trim()) {
      setErrors({ name: 'El nombre es obligatorio' });
      return;
    }
    setErrors({});
    save.mutate();
  };

  const saleTaxes = taxes.data?.items.filter((t) => !t.is_withholding && t.applies_to !== 'PURCHASE') ?? [];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={productId ? 'Editar producto' : 'Nuevo producto'}
        description="El código y la unidad se rellenan solos si los dejas en blanco."
        size="lg"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              {productId ? 'Guardar' : 'Crear'}
            </Button>
          </>
        }
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Nombre" required error={errors.name} className="sm:col-span-2">
            {(props) => (
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un diálogo el foco ya está atrapado
              <Input {...props} autoFocus value={values.name} onChange={(e) => set('name', e.target.value)} />
            )}
          </Field>

          <Field label="Código" error={errors.sku} hint="Si lo dejas vacío se genera desde el nombre">
            {(props) => <Input {...props} value={values.sku} onChange={(e) => set('sku', e.target.value)} />}
          </Field>

          <Field label="Código de barras">
            {(props) => (
              <Input {...props} inputMode="numeric" value={values.barcode} onChange={(e) => set('barcode', e.target.value)} />
            )}
          </Field>

          <Field label="Tipo">
            {(props) => (
              <Select
                {...props}
                value={values.kind}
                onChange={(e) => set('kind', e.target.value as ProductFormValues['kind'])}
              >
                {PRODUCT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Categoría">
            {(props) => (
              <Select {...props} value={values.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">Sin categoría</option>
                {categories.data?.items.map((category) => (
                  <option key={category.id} value={category.id}>
                    {'— '.repeat(category.depth)}
                    {category.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Unidad" hint={isService ? 'Por defecto, horas' : 'Por defecto, unidades'}>
            {(props) => (
              <Select {...props} value={values.uomId} onChange={(e) => set('uomId', e.target.value)}>
                <option value="">Automática</option>
                {uoms.data?.items.map((uom) => (
                  <option key={uom.id} value={uom.id}>
                    {uom.code} · {uom.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Impuesto de venta">
            {(props) => (
              <Select {...props} value={values.saleTaxId} onChange={(e) => set('saleTaxId', e.target.value)}>
                <option value="">IVA 19 % (por defecto)</option>
                {saleTaxes.map((tax) => (
                  <option key={tax.id} value={tax.id}>
                    {tax.name} · {rateLabel(tax.rate, tax.kind)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Precio de venta" hint="Sin separadores de miles">
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                placeholder="0"
                value={values.salePrice}
                onChange={(e) => set('salePrice', e.target.value)}
              />
            )}
          </Field>

          <Field label="Precio de compra">
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                placeholder="0"
                value={values.purchasePrice}
                onChange={(e) => set('purchasePrice', e.target.value)}
              />
            )}
          </Field>

          <Field label="Marca">
            {(props) => <Input {...props} value={values.brand} onChange={(e) => set('brand', e.target.value)} />}
          </Field>

          <Field label="Existencias mínimas" hint="Para avisar cuando haya que reponer">
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                disabled={isService || !values.trackInventory}
                value={values.minStock}
                onChange={(e) => set('minStock', e.target.value)}
              />
            )}
          </Field>

          <Field label="Trazabilidad" hint="Obligatoria por ley en medicamentos y alimentos">
            {(props) => (
              <Select
                {...props}
                disabled={isService || !values.trackInventory}
                value={values.tracking}
                onChange={(e) => set('tracking', e.target.value as ProductFormValues['tracking'])}
              >
                {TRACKING_MODES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Descripción" className="sm:col-span-2">
            {(props) => (
              <Textarea {...props} value={values.description} onChange={(e) => set('description', e.target.value)} />
            )}
          </Field>

          <fieldset className="sm:col-span-2 grid gap-2 rounded-[var(--radius-control)] border border-border p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-medium text-fg-muted">Opciones</legend>
            <Checkbox
              label="Se vende"
              checked={values.isSellable}
              onChange={(v) => set('isSellable', v)}
            />
            <Checkbox
              label="Se compra"
              checked={values.isPurchasable}
              onChange={(v) => set('isPurchasable', v)}
            />
            <Checkbox
              label="Lleva existencias"
              checked={!isService && values.trackInventory}
              disabled={isService}
              hint={isService ? 'Un servicio no se almacena' : undefined}
              onChange={(v) => set('trackInventory', v)}
            />
            <Checkbox
              label="El precio ya incluye impuestos"
              checked={values.priceIncludesTax}
              hint="Como se cotiza al detal"
              onChange={(v) => set('priceIncludesTax', v)}
            />
            <Checkbox label="Activo" checked={values.isActive} onChange={(v) => set('isActive', v)} />
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Checkbox({
  label,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string | undefined;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={disabled ? 'flex items-start gap-2 text-sm opacity-60' : 'flex items-start gap-2 text-sm'}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 accent-[var(--color-accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-fg-subtle">{hint}</span>}
      </span>
    </label>
  );
}

const blank = (value: string): string | null => (value.trim().length > 0 ? value.trim() : null);

/** El importe viaja como texto: convertirlo a `number` aquí perdería centavos. */
const numeric = (value: string): string => {
  const cleaned = value.trim().replace(/\s/g, '').replace(',', '.');
  return cleaned.length > 0 ? cleaned : '0';
};
