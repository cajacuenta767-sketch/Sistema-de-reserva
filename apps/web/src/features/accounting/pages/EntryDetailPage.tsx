import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Undo2 } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Textarea,
} from '@/design-system';
import { post } from '@/lib/api/client';
import { useResource } from '@/lib/api/useList';
import { Can } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { amount, date } from '@/lib/format';
import { ENTRY_STATUS, SOURCE_LABEL } from '../lib/labels';
import type { EntryDetail } from '../lib/types';

/**
 * Un asiento, con todo lo que hace falta para explicarlo.
 *
 * El enlace al documento de origen es lo que convierte un número en un hecho
 * comprobable: desde el balance se llega al asiento y desde el asiento a la
 * factura, sin buscar nada a mano.
 */
export function EntryDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');
  const [reverseDate, setReverseDate] = useState('');
  const [error, setError] = useState('');

  const query = useResource<EntryDetail>(`/accounting/entries/${id}`);

  const reverse = useMutation({
    mutationFn: () =>
      post<EntryDetail>(`/accounting/entries/${id}/reverse`, {
        reason: reason.trim(),
        ...(reverseDate ? { date: reverseDate } : {}),
      }),
    onSuccess: (result) => {
      toast.success(`Reversado con el asiento ${result.entry.number ?? ''}`);
      void queryClient.invalidateQueries({ queryKey: ['/accounting/entries'] });
      setReversing(false);
      setReason('');
      navigate(`/contabilidad/asientos/${result.entry.id}`);
    },
    onError: toast.error,
  });

  if (query.isLoading) return <PageLoader />;
  if (query.error || !query.data) {
    return (
      <ErrorState
        title="No se pudo cargar el asiento"
        description={(query.error as Error | null)?.message ?? 'No existe'}
        action={<Button onClick={() => navigate('/contabilidad/diario')}>Volver al diario</Button>}
      />
    );
  }

  const { entry, lines, source, reversal, reverses } = query.data;
  const status = ENTRY_STATUS[entry.status];

  return (
    <>
      <PageHeader
        title={entry.number ?? 'Borrador'}
        description={entry.memo}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              icon={<ArrowLeft className="size-4" />}
              onClick={() => navigate('/contabilidad/diario')}
            >
              Diario
            </Button>
            {entry.status === 'POSTED' && !entry.reversedById && (
              <Can perm="accounting:entry:reverse">
                <Button
                  variant="secondary"
                  icon={<Undo2 className="size-4" />}
                  onClick={() => setReversing(true)}
                >
                  Reversar
                </Button>
              </Can>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={status?.tone ?? 'neutral'} dot>
          {status?.label ?? entry.status}
        </Badge>
        <span className="text-fg-muted">{date(entry.entryDate)}</span>
        <span className="text-fg-subtle">·</span>
        <span className="text-fg-muted">
          {entry.journalName} ({entry.journalCode})
        </span>
        <span className="text-fg-subtle">·</span>
        <span className="text-fg-muted">{entry.periodName}</span>
        {source && (
          <Link
            to={source.url}
            className="ml-auto inline-flex items-center gap-1 text-accent hover:underline"
          >
            {source.label}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        )}
        {!source && entry.sourceType === 'MANUAL' && (
          <span className="ml-auto text-xs text-fg-subtle">
            {SOURCE_LABEL.MANUAL}
          </span>
        )}
      </div>

      {reversal && (
        <p className="rounded-[var(--radius-control)] bg-warning-soft p-3 text-sm text-warning-fg">
          Este asiento fue reversado por{' '}
          <Link to={`/contabilidad/asientos/${reversal.id}`} className="font-medium underline">
            {reversal.number}
          </Link>
          . Sigue aquí, con su número intacto: la contabilidad se corrige reversando, nunca
          borrando.
        </p>
      )}
      {reverses && (
        <p className="rounded-[var(--radius-control)] bg-info-soft p-3 text-sm text-info-fg">
          Este asiento reversa a{' '}
          <Link to={`/contabilidad/asientos/${reverses.id}`} className="font-medium underline">
            {reverses.number}
          </Link>
          .
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[42rem] text-sm">
          <caption className="sr-only">Líneas del asiento {entry.number ?? 'en borrador'}</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Cuenta</th>
              <th className="px-3 py-2 font-medium">Concepto</th>
              <th className="px-3 py-2 font-medium">Tercero</th>
              <th className="px-3 py-2 text-right font-medium">Débito</th>
              <th className="px-3 py-2 text-right font-medium">Crédito</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={line.id}>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-fg-muted">{line.accountCode}</div>
                  <div>{line.accountName}</div>
                </td>
                <td className="px-3 py-2 text-fg-muted">{line.description}</td>
                <td className="px-3 py-2">
                  {line.partyName ?? <span className="text-fg-subtle">—</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(line.debit) > 0 ? (
                    amount(line.debit, 0)
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {Number(line.credit) > 0 ? (
                    amount(line.credit, 0)
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-surface-2 font-semibold">
            <tr>
              <td className="px-3 py-2" colSpan={3}>
                Sumas iguales
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{amount(entry.debitTotal, 0)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{amount(entry.creditTotal, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <Dialog open={reversing} onOpenChange={setReversing}>
        <DialogContent title="Reversar el asiento" description={entry.number ?? ''}>
          <div className="grid gap-3">
            <Field
              label="Motivo"
              required
              error={error || undefined}
              hint="Queda en el concepto del asiento de reversión y en la auditoría."
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Por qué se reversa"
                />
              )}
            </Field>
            <Field
              label="Fecha de la reversión"
              hint="Vacío la fecha hoy. Reversar con la fecha del original cambiaría un periodo que quizá ya se declaró."
            >
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={reverseDate}
                  onChange={(e) => setReverseDate(e.target.value)}
                />
              )}
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReversing(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                loading={reverse.isPending}
                onClick={() => {
                  if (!reason.trim()) {
                    setError('Escribe el motivo de la reversión');
                    return;
                  }
                  setError('');
                  reverse.mutate();
                }}
              >
                Reversar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
