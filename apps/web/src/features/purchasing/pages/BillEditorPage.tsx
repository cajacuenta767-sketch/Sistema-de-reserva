import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { Badge, Button, Field, Input, PageHeader, Textarea } from '@/design-system';
import { post } from '@/lib/api/client';
import { useCollection } from '@/lib/api/useList';
import { useToast } from '@/store/toast';
import { LineEditor, emptyLine, type EditableLine } from '@/features/sales/components/LineEditor';
import { PartyPicker } from '@/features/sales/components/PartyPicker';
import type { BillRow } from '../lib/types';

interface Tax {
  id: string;
  code: string;
  name: string;
  rate: string;
  is_withholding: boolean;
  is_active: boolean;
}

/**
 * Registrar una factura de proveedor.
 *
 * El número que se pide es el DEL PROVEEDOR, no uno interno: es el que la DIAN
 * cruza y el que impide pagar dos veces lo mismo.
 */
export function BillEditorPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const taxes = useCollection<Tax>('/taxes');

  const [supplierNumber, setSupplierNumber] = useState('');
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [terms, setTerms] = useState('30');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [withheld, setWithheld] = useState<string[]>([]);
  const [error, setError] = useState('');

  const retenciones = (taxes.data?.items ?? []).filter((t) => t.is_withholding && t.is_active);

  const save = useMutation({
    mutationFn: () =>
      post<{ bill: BillRow }>('/purchasing/bills', {
        supplierNumber: supplierNumber.trim(),
        partyId,
        issueDate,
        paymentTermsDays: Number(terms) || 0,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(withheld.length > 0 ? { withholdingTaxIds: withheld } : {}),
        lines: lines
          .filter((l) => l.description.trim() && Number(l.quantity.replace(',', '.')) > 0)
          .map((l) => ({
            ...(l.productId ? { productId: l.productId } : {}),
            description: l.description.trim(),
            quantity: l.quantity.replace(',', '.'),
            unitPrice: (l.unitPrice || '0').replace(',', '.'),
            ...(l.discountPercent.trim()
              ? { discountPercent: l.discountPercent.replace(',', '.') }
              : {}),
          })),
      }),
    onSuccess: (result) => {
      toast.success('Factura registrada');
      void queryClient.invalidateQueries({ queryKey: ['/purchasing/bills'] });
      navigate(`/compras/facturas/${result.bill.id}`);
    },
    onError: toast.error,
  });

  return (
    <>
      <PageHeader
        title="Registrar factura de proveedor"
        description="Lo que te cobran, con su número y sus retenciones"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft className="size-4" />}
              onClick={() => navigate('/compras/facturas')}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              icon={<Save className="size-4" />}
              loading={save.isPending}
              onClick={() => {
                if (!supplierNumber.trim()) return setError('Escribe el número de la factura');
                if (!partyId) return setError('Elige el proveedor');
                if (!lines.some((l) => l.description.trim())) return setError('Añade al menos una línea');
                setError('');
                save.mutate();
              }}
            >
              Guardar
            </Button>
          </div>
        }
      />

      <div className="card grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Proveedor" required className="sm:col-span-2">
          {(props) => (
            <PartyPicker
              {...props}
              value={partyId}
              label={partyName}
              onPick={(party) => {
                setPartyId(party.id);
                setPartyName(party.display_name);
              }}
            />
          )}
        </Field>
        <Field
          label="Número de la factura"
          required
          hint="El que trae la factura del proveedor, no uno interno."
        >
          {(props) => (
            <Input
              {...props}
              value={supplierNumber}
              onChange={(e) => setSupplierNumber(e.target.value)}
              placeholder="FV-9001"
            />
          )}
        </Field>
        <Field label="Fecha de la factura">
          {(props) => (
            <Input
              {...props}
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          )}
        </Field>
        <Field label="Plazo de pago" hint="Días hasta el vencimiento.">
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          )}
        </Field>
      </div>

      <LineEditor mode="PURCHASE" lines={lines} currency="COP" onChange={setLines} />

      {retenciones.length > 0 && (
        <div className="card">
          <h2 className="mb-2 text-sm font-medium">Retenciones que se le practican</h2>
          <p className="mb-3 text-xs text-fg-muted">
            Reducen lo que se le transfiere al proveedor y se convierten en una deuda con la DIAN:
            ese dinero hay que consignarlo.
          </p>
          <div className="flex flex-wrap gap-2">
            {retenciones.map((tax) => {
              const active = withheld.includes(tax.id);
              return (
                <button
                  key={tax.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setWithheld((current) =>
                      active ? current.filter((t) => t !== tax.id) : [...current, tax.id],
                    )
                  }
                  className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  <Badge tone={active ? 'accent' : 'neutral'} dot={active}>
                    {tax.name} · {tax.rate} %
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <Field label="Notas">
          {(props) => (
            <Textarea {...props} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
        </Field>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft p-3 text-sm text-danger-soft-fg">
          {error}
        </p>
      )}
    </>
  );
}
