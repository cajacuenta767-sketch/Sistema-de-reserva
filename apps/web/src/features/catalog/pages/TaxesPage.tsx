import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Percent, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Empty,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { del, patch, post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { money } from '@/lib/format';
import { TAX_KINDS, rateLabel, taxKindLabel } from '../lib/labels';
import type { Tax } from '../lib/types';

/**
 * Impuestos de la organización.
 *
 * Se siembran al crear la empresa con las tarifas del Estatuto Tributario, y son
 * datos editables y no constantes del programa: cada reforma tributaria cambia
 * tarifas y bases, y eso no puede exigir una nueva versión del sistema.
 */
export function TaxesPage() {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Tax | 'new' | null>(null);

  const query = useCollection<Tax>('/taxes');
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['/taxes'] });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/taxes/${id}`),
    onSuccess: () => {
      toast.success('Impuesto eliminado');
      invalidate();
    },
    onError: toast.error,
  });

  const toggleActive = useMutation({
    mutationFn: (tax: Tax) => patch(`/taxes/${tax.id}`, { is_active: !tax.is_active }),
    onSuccess: invalidate,
    onError: toast.error,
  });

  const items = query.data?.items ?? [];
  const sales = items.filter((t) => !t.is_withholding);
  const withholdings = items.filter((t) => t.is_withholding);

  return (
    <>
      <PageHeader
        title="Impuestos"
        description="IVA, impuesto al consumo y retenciones, con sus códigos DIAN"
        actions={
          <Can perm="catalog:tax:manage">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Nuevo impuesto
            </Button>
          </Can>
        }
      />

      {query.isLoading && <Spinner />}
      {!query.isLoading && items.length === 0 && (
        <Empty icon={<Percent className="size-6" />} title="Sin impuestos configurados" />
      )}

      <Group
        title="Sobre la venta"
        description="Se suman al precio y se cobran al cliente."
        taxes={sales}
        can={can}
        onEdit={setEditing}
        onToggle={(tax) => toggleActive.mutate(tax)}
        onRemove={(tax) => remove.mutate(tax.id)}
      />

      <Group
        title="Retenciones"
        description="Se descuentan al pagar a un proveedor. Solo aplican por encima de su base mínima."
        taxes={withholdings}
        can={can}
        onEdit={setEditing}
        onToggle={(tax) => toggleActive.mutate(tax)}
        onRemove={(tax) => remove.mutate(tax.id)}
      />

      {editing && (
        <TaxDialog
          tax={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </>
  );
}

function Group({
  title,
  description,
  taxes,
  can,
  onEdit,
  onToggle,
  onRemove,
}: {
  title: string;
  description: string;
  taxes: Tax[];
  can: (permission: string) => boolean;
  onEdit: (tax: Tax) => void;
  onToggle: (tax: Tax) => void;
  onRemove: (tax: Tax) => void;
}) {
  if (taxes.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-fg-muted">{description}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {taxes.map((tax) => (
          <li key={tax.id} className="card space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-fg-subtle">{tax.code}</span>
                  {!tax.is_active && <Badge tone="neutral">Inactivo</Badge>}
                </div>
                <p className="truncate font-medium">{tax.name}</p>
              </div>
              <span className="shrink-0 text-lg font-semibold tabular-nums">
                {rateLabel(tax.rate, tax.kind)}
              </span>
            </div>

            <dl className="space-y-0.5 text-xs text-fg-muted">
              <div className="flex gap-2">
                <dt>Tipo</dt>
                <dd className="font-medium text-fg">{taxKindLabel(tax.kind)}</dd>
              </div>
              {tax.min_base && (
                <div className="flex gap-2">
                  <dt>Base mínima</dt>
                  <dd className="font-medium text-fg">{money(tax.min_base)}</dd>
                </div>
              )}
              {tax.dian_tax_code && (
                <div className="flex gap-2">
                  <dt>Código DIAN</dt>
                  <dd className="font-medium text-fg">{tax.dian_tax_code}</dd>
                </div>
              )}
            </dl>

            {can('catalog:tax:manage') && (
              <div className="flex gap-1 pt-1">
                <Button size="sm" onClick={() => onEdit(tax)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onToggle(tax)}>
                  {tax.is_active ? 'Desactivar' : 'Activar'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-4" />}
                  aria-label={`Eliminar ${tax.name}`}
                  onClick={() => onRemove(tax)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TaxDialog({ tax, onClose, onSaved }: { tax: Tax | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState({
    code: tax?.code ?? '',
    name: tax?.name ?? '',
    kind: tax?.kind ?? 'VAT',
    rate: tax?.rate ?? '',
    appliesTo: tax?.applies_to ?? 'BOTH',
    minBase: tax?.min_base ?? '',
    dianTaxCode: tax?.dian_tax_code ?? '',
  });
  const [error, setError] = useState('');

  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const isWithholding = values.kind.startsWith('WITHHOLDING_');

  const save = useMutation({
    mutationFn: () => {
      const rate = values.rate.replace(',', '.');
      return tax
        ? patch(`/taxes/${tax.id}`, {
            code: values.code.trim().toUpperCase(),
            name: values.name.trim(),
            rate,
            applies_to: values.appliesTo,
            min_base: values.minBase ? values.minBase.replace(',', '.') : null,
            dian_tax_code: values.dianTaxCode.trim() || null,
          })
        : post('/taxes', {
            code: values.code.trim().toUpperCase(),
            name: values.name.trim(),
            kind: values.kind,
            rate,
            appliesTo: values.appliesTo,
            minBase: values.minBase ? values.minBase.replace(',', '.') : null,
            dianTaxCode: values.dianTaxCode.trim() || null,
          });
    },
    onSuccess: () => {
      toast.success('Impuesto guardado');
      onSaved();
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!values.code.trim() || !values.name.trim() || !values.rate.trim()) {
      setError('Código, nombre y tarifa son obligatorios');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={tax ? 'Editar impuesto' : 'Nuevo impuesto'}
        description={
          tax
            ? 'Cambiar la tarifa afecta a los documentos futuros; los ya emitidos guardan la suya.'
            : undefined
        }
        size="md"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Guardar
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
          {error && <p className="sm:col-span-2 text-sm text-danger-fg">{error}</p>}

          <Field label="Código" required>
            {(props) => (
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un diálogo el foco ya está atrapado
              <Input {...props} autoFocus value={values.code} onChange={(e) => set('code', e.target.value)} />
            )}
          </Field>

          <Field label="Tipo">
            {(props) => (
              <Select {...props} disabled={Boolean(tax)} value={values.kind} onChange={(e) => set('kind', e.target.value)}>
                {TAX_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Nombre" required className="sm:col-span-2">
            {(props) => <Input {...props} value={values.name} onChange={(e) => set('name', e.target.value)} />}
          </Field>

          <Field
            label="Tarifa"
            required
            hint={
              values.kind === 'WITHHOLDING_ICA'
                ? 'En porcentaje: 9,66 por mil se escribe 0,966'
                : 'En porcentaje: 19 para el 19 %'
            }
          >
            {(props) => (
              <Input {...props} inputMode="decimal" value={values.rate} onChange={(e) => set('rate', e.target.value)} />
            )}
          </Field>

          <Field label="Aplica en">
            {(props) => (
              <Select
                {...props}
                disabled={isWithholding}
                value={isWithholding ? 'PURCHASE' : values.appliesTo}
                onChange={(e) => set('appliesTo', e.target.value)}
              >
                <option value="BOTH">Ventas y compras</option>
                <option value="SALE">Solo ventas</option>
                <option value="PURCHASE">Solo compras</option>
              </Select>
            )}
          </Field>

          <Field label="Base mínima" hint="Por debajo de este importe no se retiene">
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                disabled={!isWithholding}
                value={values.minBase}
                onChange={(e) => set('minBase', e.target.value)}
              />
            )}
          </Field>

          <Field label="Código DIAN" hint="Anexo técnico de factura electrónica">
            {(props) => (
              <Input {...props} value={values.dianTaxCode} onChange={(e) => set('dianTaxCode', e.target.value)} />
            )}
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
