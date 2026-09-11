import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Badge, Button, ErrorState, PageHeader, PageLoader, Select } from '@/design-system';
import { put } from '@/lib/api/client';
import { useResource } from '@/lib/api/useList';
import { useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import type { AccountNode, AccountRoleRow } from '../lib/types';

const postableOf = (nodes: readonly AccountNode[]): AccountNode[] =>
  nodes.flatMap((node) => [
    ...(node.isPostable && node.isActive ? [node] : []),
    ...postableOf(node.children),
  ]);

/**
 * Cuentas por operación.
 *
 * El motor de contabilización no conoce ni un código del PUC: pide roles ("la
 * cuenta de clientes") y esta pantalla decide cuál es en esta empresa. Es lo que
 * permite cambiar de plan de cuentas sin tocar el motor, y lo que hay que
 * revisar cuando un asiento falla diciendo que falta una cuenta.
 */
export function AccountRolesPage() {
  const roles = useResource<AccountRoleRow[]>('/accounting/account-roles');
  const accounts = useResource<AccountNode[]>('/accounting/accounts/tree');
  const postable = useMemo(() => postableOf(accounts.data ?? []), [accounts.data]);
  const queryClient = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const editable = can('accounting:account:update');

  const assign = useMutation({
    mutationFn: ({ role, accountId }: { role: string; accountId: string }) =>
      put(`/accounting/account-roles/${role}`, { accountId }),
    onSuccess: () => {
      toast.success('Cuenta asignada');
      void queryClient.invalidateQueries({ queryKey: ['/accounting/account-roles'] });
    },
    onError: toast.error,
  });

  if (roles.isLoading || accounts.isLoading) return <PageLoader />;
  if (roles.error) {
    return (
      <ErrorState
        title="No se pudieron cargar las cuentas por operación"
        description={(roles.error as Error).message}
        action={<Button onClick={() => void roles.refetch()}>Reintentar</Button>}
      />
    );
  }

  const rows = roles.data ?? [];
  const missing = rows.filter((r) => r.required && !r.accountId);

  return (
    <>
      <PageHeader
        title="Cuentas por operación"
        description="Qué cuenta usa cada cosa que contabiliza el sistema"
      />

      {missing.length > 0 && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-control)] bg-danger-soft p-3 text-sm text-danger-soft-fg"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Faltan {missing.length} cuenta(s) obligatoria(s). Mientras no se asignen, emitir una
            factura fallará en el momento de contabilizarla.
          </span>
        </p>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[46rem] text-sm">
          <caption className="sr-only">Cuenta asignada a cada operación contable</caption>
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Operación</th>
              <th className="px-3 py-2 font-medium">Para qué se usa</th>
              <th className="px-3 py-2 font-medium">Cuenta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.role}>
                <td className="px-3 py-2">
                  <div className="font-medium">{row.label}</div>
                  {row.required ? (
                    <Badge tone="neutral">Obligatoria</Badge>
                  ) : (
                    <span className="text-xs text-fg-subtle">Opcional</span>
                  )}
                </td>
                <td className="px-3 py-2 text-fg-muted">{row.usedFor}</td>
                <td className="px-3 py-2">
                  {editable ? (
                    <Select
                      value={row.accountId ?? ''}
                      aria-label={`Cuenta para ${row.label}`}
                      onChange={(e) =>
                        e.target.value && assign.mutate({ role: row.role, accountId: e.target.value })
                      }
                    >
                      <option value="">Sin asignar</option>
                      {postable.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.code} · {account.name}
                        </option>
                      ))}
                    </Select>
                  ) : row.accountId ? (
                    <span>
                      <span className="font-mono text-xs text-fg-muted">{row.accountCode}</span>{' '}
                      {row.accountName}
                    </span>
                  ) : (
                    <span className="text-fg-subtle">Sin asignar</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
