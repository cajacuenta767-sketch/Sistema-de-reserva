import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, Field, Input, Textarea } from '@/design-system';
import { post } from '@/lib/api/client';
import { useToast } from '@/store/toast';
import { money } from '@/lib/format';
import { LineEditor, emptyLine, linesSubtotal, type EditableLine } from './LineEditor';
import { PartyPicker } from './PartyPicker';

/** Alta de una cotización. La edición posterior se hace desde la misma pantalla. */
export function QuoteEditorDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [validForDays, setValidForDays] = useState('15');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLine[]>([emptyLine()]);
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () =>
      post('/quotes', {
        partyId,
        ...(Number(validForDays) > 0 ? { validForDays: Number(validForDays) } : {}),
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
      }),
    onSuccess: () => {
      toast.success('Cotización creada');
      onSaved();
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!partyId) {
      setError('Elige el cliente');
      return;
    }
    if (!lines.some((l) => l.description.trim())) {
      setError('La cotización necesita al menos una línea');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Nueva cotización"
        description="La validez evita que una oferta de hace meses siga pareciendo vigente."
        size="xl"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Crear
            </Button>
          </>
        }
      >
        {error && (
          <p className="rounded-[var(--radius-control)] bg-danger-soft p-3 text-sm text-danger-soft-fg" role="alert">
            {error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Cliente" required className="sm:col-span-2">
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
          <Field label="Válida durante" hint="Días">
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={validForDays}
                onChange={(e) => setValidForDays(e.target.value)}
              />
            )}
          </Field>
        </div>

        <LineEditor lines={lines} currency="COP" onChange={setLines} />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="Notas" className="flex-1">
            {(props) => <Textarea {...props} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <div className="text-right">
            <p className="text-xs text-fg-subtle">Base aproximada</p>
            <p className="text-lg font-semibold tabular-nums">{money(String(linesSubtotal(lines)))}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
