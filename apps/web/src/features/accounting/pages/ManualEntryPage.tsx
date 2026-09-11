import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Select,
  Textarea,
} from '@/design-system';
import { post } from '@/lib/api/client';
import { useResource } from '@/lib/api/useList';
import { useToast } from '@/store/toast';
import { amount } from '@/lib/format';
import type { AccountNode, EntryDetail } from '../lib/types';

interface DraftLine {
  key: string;
  accountId: string;
  side: 'DEBIT' | 'CREDIT';
  value: string;
  description: string;
}

const emptyLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  accountId: '',
  side: 'DEBIT',
  value: '',
  description: '',
});

/** Aplana el árbol a las cuentas que reciben movimiento. */
const postableOf = (nodes: readonly AccountNode[]): AccountNode[] =>
  nodes.flatMap((node) => [
    ...(node.isPostable && node.isActive ? [node] : []),
    ...postableOf(node.children),
  ]);

const toNumber = (raw: string): number => Number(raw.replace(/\./g, '').replace(',', '.')) || 0;

/**
 * Asiento manual.
 *
 * El cuadre se ve mientras se escribe, no al guardar. Un formulario que acepta
 * el asiento y lo rechaza al enviarlo obliga a buscar el error en una pantalla
 * que ya no muestra las sumas, y los asientos manuales de un cierre tienen
 * quince líneas.
 */
export function ManualEntryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const accounts = useResource<AccountNode[]>('/accounting/accounts/tree?onlyActive=true');
  const postable = useMemo(() => postableOf(accounts.data ?? []), [accounts.data]);

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<DraftLine[]>(() => [
    { ...emptyLine(), side: 'DEBIT' },
    { ...emptyLine(), side: 'CREDIT' },
  ]);
  const [error, setError] = useState('');

  const debit = lines
    .filter((l) => l.side === 'DEBIT')
    .reduce((acc, l) => acc + toNumber(l.value), 0);
  const credit = lines
    .filter((l) => l.side === 'CREDIT')
    .reduce((acc, l) => acc + toNumber(l.value), 0);
  const difference = debit - credit;
  const balanced = Math.abs(difference) < 0.005 && debit > 0;

  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    mutationFn: () =>
      post<EntryDetail>('/accounting/entries', {
        date: entryDate,
        memo: memo.trim(),
        lines: lines
          .filter((l) => l.accountId && toNumber(l.value) > 0)
          .map((l) => ({
            accountId: l.accountId,
            [l.side === 'DEBIT' ? 'debit' : 'credit']: String(toNumber(l.value)),
            ...(l.description.trim() ? { description: l.description.trim() } : {}),
          })),
      }),
    onSuccess: (result) => {
      toast.success(`Asiento ${result.entry.number ?? ''} contabilizado`);
      void queryClient.invalidateQueries({ queryKey: ['/accounting/entries'] });
      navigate(`/contabilidad/asientos/${result.entry.id}`);
    },
    onError: toast.error,
  });

  if (accounts.isLoading) return <PageLoader />;

  const submit = () => {
    const usable = lines.filter((l) => l.accountId && toNumber(l.value) > 0);
    if (!memo.trim()) return setError('Escribe el concepto del asiento');
    if (usable.length < 2) return setError('Un asiento mueve al menos dos cuentas');
    if (!balanced) {
      return setError(
        `El asiento no cuadra: faltan ${amount(String(Math.abs(difference)), 2)} ` +
          (difference > 0 ? 'al crédito' : 'al débito'),
      );
    }
    setError('');
    save.mutate();
  };

  return (
    <>
      <PageHeader
        title="Asiento manual"
        description="Se contabiliza al guardar: no queda como borrador"
        actions={
          <Button
            variant="ghost"
            icon={<ArrowLeft className="size-4" />}
            onClick={() => navigate('/contabilidad/diario')}
          >
            Cancelar
          </Button>
        }
      />

      <div className="card grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field label="Fecha" required>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          )}
        </Field>
        <Field label="Concepto" required hint="Lo que explica el asiento en el libro diario.">
          {(props) => (
            <Textarea
              {...props}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
              placeholder="Por ejemplo: compra de papelería en efectivo"
            />
          )}
        </Field>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[46rem] text-sm">
          <caption className="sr-only">Líneas del asiento</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Cuenta</th>
              <th className="px-3 py-2 font-medium">Concepto de la línea</th>
              <th className="px-3 py-2 font-medium">Lado</th>
              <th className="px-3 py-2 text-right font-medium">Importe</th>
              <th className="w-10 px-3 py-2">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line, index) => (
              <tr key={line.key}>
                <td className="px-3 py-2">
                  <Select
                    value={line.accountId}
                    onChange={(e) => update(line.key, { accountId: e.target.value })}
                    aria-label={`Cuenta de la línea ${index + 1}`}
                  >
                    <option value="">Elige una cuenta…</option>
                    {postable.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} · {account.name}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={line.description}
                    onChange={(e) => update(line.key, { description: e.target.value })}
                    placeholder="Opcional"
                    aria-label={`Concepto de la línea ${index + 1}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <Select
                    value={line.side}
                    onChange={(e) =>
                      update(line.key, { side: e.target.value as DraftLine['side'] })
                    }
                    aria-label={`Lado de la línea ${index + 1}`}
                  >
                    <option value="DEBIT">Débito</option>
                    <option value="CREDIT">Crédito</option>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Input
                    inputMode="decimal"
                    value={line.value}
                    onChange={(e) => update(line.key, { value: e.target.value })}
                    className="text-right tabular-nums"
                    aria-label={`Importe de la línea ${index + 1}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar la línea ${index + 1}`}
                    disabled={lines.length <= 2}
                    onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-surface-2">
            <tr className="font-semibold">
              <td className="px-3 py-2" colSpan={3}>
                Sumas
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <div>{amount(String(debit), 0)}</div>
                <div className="font-normal text-fg-muted">{amount(String(credit), 0)}</div>
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setLines((c) => [...c, emptyLine()])}>
          Añadir línea
        </Button>
        <Badge tone={balanced ? 'success' : 'warning'} dot>
          {balanced
            ? 'El asiento cuadra'
            : difference === 0
              ? 'Sin importes'
              : `Diferencia de ${amount(String(Math.abs(difference)), 2)} ${difference > 0 ? 'al crédito' : 'al débito'}`}
        </Badge>
        <Button
          variant="primary"
          className="ml-auto"
          loading={save.isPending}
          disabled={!balanced}
          onClick={submit}
        >
          Contabilizar
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] bg-danger-soft p-3 text-sm text-danger-soft-fg">
          {error}
        </p>
      )}
    </>
  );
}
