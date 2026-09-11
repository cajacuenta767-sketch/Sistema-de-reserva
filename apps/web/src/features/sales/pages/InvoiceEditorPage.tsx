import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import {
  Button,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Textarea,
} from '@/design-system';
import { useCollection, useResource } from '@/lib/api/useList';
import { patch, post } from '@/lib/api/client';
import { useToast } from '@/store/toast';
import { money } from '@/lib/format';
import { LineEditor, emptyLine, linesSubtotal, type EditableLine } from '../components/LineEditor';
import { PartyPicker } from '../components/PartyPicker';
import type { InvoiceDetail } from '../lib/types';

interface Tax {
  id: string;
  code: string;
  name: string;
  rate: string;
  is_withholding: boolean;
  is_active: boolean;
}

/**
 * Alta y edición de un borrador de factura.
 *
 * Solo edita BORRADORES: una factura emitida es inmutable, y el backend lo
 * impide. Aquí ni siquiera se ofrece, para no llevar a alguien hasta el botón
 * de guardar y rechazarle el cambio al final.
 */
export function InvoiceEditorPage() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const existing = useResource<InvoiceDetail>(editing ? `/invoices/${id}` : null);
  const taxes = useCollection<Tax>('/taxes');

  /*
   * El formulario es un BORRADOR SUPERPUESTO sobre lo que devuelve el servidor.
   *
   * Copiar los datos a estado al cargar —desde un efecto— crea un segundo origen
   * de verdad: si la consulta se revalida, el formulario se queda con la versión
   * vieja sin que nadie lo note. Aquí solo se guarda lo que el usuario ha
   * tocado, y el resto se lee del servidor en cada render.
   */
  interface Draft {
    partyId: string;
    partyName: string;
    issueDate: string;
    paymentTermsDays: string;
    globalDiscount: string;
    withholdings: string[];
    notes: string;
    lines: EditableLine[];
  }
  const [draft, setDraft] = useState<Partial<Draft>>({});
  const [error, setError] = useState('');

  const loaded = existing.data;
  const base: Draft = {
    partyId: loaded?.invoice.partyId ?? '',
    partyName: '',
    issueDate: loaded?.invoice.issueDate ?? '',
    paymentTermsDays: String(loaded?.invoice.paymentTermsDays ?? 30),
    globalDiscount:
      loaded && Number(loaded.invoice.globalDiscountPercent) > 0 ? loaded.invoice.globalDiscountPercent : '',
    withholdings: loaded?.withholdings.map((w) => w.code) ?? [],
    notes: loaded?.invoice.notes ?? '',
    lines:
      loaded?.lines.map((l) => ({
        key: l.id,
        productId: l.productId,
        description: l.description,
        sku: l.sku,
        quantity: trim(l.quantity),
        unitPrice: trim(l.unitPrice),
        discountPercent: Number(l.discountPercent) > 0 ? trim(l.discountPercent) : '',
        taxId: l.taxes[0]?.taxId ?? null,
      })) ?? [emptyLine()],
  };

  const form = { ...base, ...draft };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const { partyId, partyName, issueDate, paymentTermsDays, globalDiscount, withholdings, notes, lines } = form;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        partyId,
        ...(issueDate ? { issueDate } : {}),
        paymentTermsDays: Number(paymentTermsDays) || 0,
        ...(globalDiscount.trim() ? { globalDiscountPercent: globalDiscount.replace(',', '.') } : {}),
        withholdingCodes: withholdings,
        notes: notes.trim() || null,
        lines: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            productId: l.productId,
            description: l.description.trim(),
            quantity: l.quantity.replace(',', '.') || '1',
            ...(l.unitPrice.trim() ? { unitPrice: l.unitPrice.replace(',', '.') } : {}),
            ...(l.discountPercent.trim() ? { discountPercent: l.discountPercent.replace(',', '.') } : {}),
            ...(l.taxId ? { taxId: l.taxId } : {}),
          })),
      };
      return editing
        ? patch<InvoiceDetail>(`/invoices/${id}`, body)
        : post<InvoiceDetail>('/invoices', body);
    },
    onSuccess: (detail) => {
      toast.success(editing ? 'Borrador actualizado' : 'Borrador creado');
      void queryClient.invalidateQueries({ queryKey: ['/invoices'] });
      navigate(`/facturas/${detail.invoice.id}`);
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!partyId) {
      setError('Elige el cliente al que se factura');
      return;
    }
    if (!lines.some((l) => l.description.trim())) {
      setError('La factura necesita al menos una línea con concepto');
      return;
    }
    setError('');
    save.mutate();
  };

  if (editing && existing.isLoading) return <PageLoader />;
  if (editing && existing.data && existing.data.invoice.status !== 'DRAFT') {
    return (
      <ErrorState
        title="Esta factura ya está emitida"
        description="Una factura emitida no se modifica: corrígela con una nota de crédito."
        action={<Button onClick={() => navigate(`/facturas/${id}`)}>Ver la factura</Button>}
      />
    );
  }

  const availableWithholdings = taxes.data?.items.filter((t) => t.is_withholding && t.is_active) ?? [];
  const orientative = linesSubtotal(lines) * (1 - (Number(globalDiscount.replace(',', '.')) || 0) / 100);

  return (
    <>
      <PageHeader
        title={editing ? 'Editar borrador' : 'Nueva factura'}
        description="El borrador no consume consecutivo; el número se asigna al emitir"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon={<ArrowLeft className="size-4" />} onClick={() => navigate('/facturas')}>
              Volver
            </Button>
            <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} onClick={submit}>
              Guardar borrador
            </Button>
          </div>
        }
      />

      {error && (
        <p className="rounded-[var(--radius-control)] bg-danger-soft p-3 text-sm text-danger-soft-fg" role="alert">
          {error}
        </p>
      )}

      <section className="card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Cliente" required className="sm:col-span-2">
            {(props) => (
              <PartyPicker
                {...props}
                value={partyId}
                label={partyName}
                onPick={(party) => {
                  set('partyId', party.id);
                  set('partyName', party.display_name);
                }}
              />
            )}
          </Field>
          <Field label="Fecha de emisión">
            {(props) => (
              <Input {...props} type="date" value={issueDate} onChange={(e) => set('issueDate', e.target.value)} />
            )}
          </Field>
          <Field label="Plazo de pago" hint="Días para el vencimiento">
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={paymentTermsDays}
                onChange={(e) => set('paymentTermsDays', e.target.value)}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Líneas</h2>
        <LineEditor lines={lines} currency="COP" onChange={(next) => set('lines', next)} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 p-4">
          <h2 className="text-sm font-semibold">Ajustes del documento</h2>
          <Field label="Descuento global (%)" hint="Se reparte entre las líneas antes de los impuestos">
            {(props) => (
              <Input
                {...props}
                inputMode="decimal"
                placeholder="0"
                value={globalDiscount}
                onChange={(e) => set('globalDiscount', e.target.value)}
              />
            )}
          </Field>

          <fieldset className="space-y-1">
            <legend className="label">Retenciones que practica el cliente</legend>
            <p className="text-xs text-fg-subtle">
              Solo se aplican si la base del documento supera su mínimo legal.
            </p>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {availableWithholdings.map((tax) => (
                <label key={tax.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-accent)]"
                    checked={withholdings.includes(tax.code)}
                    onChange={(e) =>
                      set(
                        'withholdings',
                        e.target.checked
                          ? [...withholdings, tax.code]
                          : withholdings.filter((c) => c !== tax.code),
                      )
                    }
                  />
                  <span className="truncate">{tax.name}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <Field label="Notas">
            {(props) => <Textarea {...props} value={notes} onChange={(e) => set('notes', e.target.value)} />}
          </Field>
        </section>

        <section className="card space-y-2 p-4">
          <h2 className="text-sm font-semibold">Totales</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-fg-muted">Base aproximada</dt>
              <dd className="tabular-nums">{money(String(orientative))}</dd>
            </div>
          </dl>
          <p className="text-xs text-fg-subtle">
            Es una estimación mientras escribes. Los impuestos y las retenciones los calcula el servidor
            al guardar, con las mismas reglas que se imprimen en la factura.
          </p>
        </section>
      </div>
    </>
  );
}

/** Quita los ceros de relleno de un NUMERIC para que el campo sea editable. */
const trim = (value: string): string => String(Number(value));
