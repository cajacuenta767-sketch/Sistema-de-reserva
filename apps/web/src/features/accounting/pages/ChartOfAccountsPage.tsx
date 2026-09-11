import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Coins, Landmark, Users } from 'lucide-react';
import { Badge, Button, ErrorState, Input, PageHeader, PageLoader } from '@/design-system';
import { useResource } from '@/lib/api/useList';
import { ACCOUNT_NATURE, ACCOUNT_TYPE, LEVEL_NAME } from '../lib/labels';
import type { AccountNode } from '../lib/types';

/**
 * Plan Único de Cuentas.
 *
 * El árbol arranca plegado a las clases. Un PUC colombiano tiene cientos de
 * cuentas y desplegarlo entero no es un plan de cuentas: es un listado. Al
 * buscar se despliega solo lo que casa, que es cuando el detalle sí importa.
 */
export function ChartOfAccountsPage() {
  const query = useResource<AccountNode[]>('/accounting/accounts/tree');
  const [search, setSearch] = useState('');
  const [manual, setManual] = useState<Set<string>>(new Set());

  const term = search.trim().toLowerCase();

  /** Códigos que hay que desplegar para que se vea todo lo que casa. */
  const matching = useMemo(() => {
    if (!term) return null;
    const open = new Set<string>();
    const visit = (node: AccountNode, ancestors: string[]): boolean => {
      const self =
        node.code.includes(term) || node.name.toLowerCase().includes(term);
      const children = node.children.filter((c) => visit(c, [...ancestors, node.code]));
      if (self || children.length > 0) {
        for (const a of ancestors) open.add(a);
        return true;
      }
      return false;
    };
    for (const root of query.data ?? []) visit(root, []);
    return open;
  }, [term, query.data]);

  const isOpen = (code: string): boolean =>
    matching ? matching.has(code) || manual.has(code) : manual.has(code);

  const toggle = (code: string) =>
    setManual((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const visible = (node: AccountNode): boolean => {
    if (!term) return true;
    if (node.code.includes(term) || node.name.toLowerCase().includes(term)) return true;
    return node.children.some(visible);
  };

  const renderNode = (node: AccountNode, depth: number) => {
    if (!visible(node)) return null;
    const hasChildren = node.children.length > 0;
    const open = isOpen(node.code);

    return (
      <li key={node.id}>
        <div
          className="flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-surface-2"
          style={{ paddingLeft: `${0.5 + depth * 1.15}rem` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(node.code)}
              aria-expanded={open}
              aria-label={`${open ? 'Contraer' : 'Desplegar'} ${node.code} ${node.name}`}
              className="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ) : (
            <span className="inline-block size-5" aria-hidden="true" />
          )}

          <span className="w-20 shrink-0 font-mono text-xs text-fg-muted">{node.code}</span>
          <span className={node.isPostable ? 'min-w-0 truncate' : 'min-w-0 truncate font-medium'}>
            {node.name}
          </span>

          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {node.requiresParty && (
              <span title="Exige tercero: sin él no hay auxiliar que cobrar ni que pagar">
                <Users className="size-3.5 text-fg-subtle" aria-label="Exige tercero" />
              </span>
            )}
            {node.isCash && (
              <span title="Cuenta de efectivo: entra en el flujo de caja y en la conciliación">
                <Coins className="size-3.5 text-fg-subtle" aria-label="Cuenta de efectivo" />
              </span>
            )}
            {!node.isActive && <Badge tone="neutral">Inactiva</Badge>}
            <Badge tone={ACCOUNT_TYPE[node.type].tone}>{ACCOUNT_TYPE[node.type].label}</Badge>
            <span className="hidden w-20 text-right text-xs text-fg-subtle sm:inline">
              {node.isPostable ? ACCOUNT_NATURE[node.nature] : (LEVEL_NAME[node.level] ?? '')}
            </span>
          </span>
        </div>

        {hasChildren && open && (
          <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Plan de cuentas"
        description="El PUC colombiano de tu empresa"
        actions={
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código o nombre…"
            aria-label="Buscar en el plan de cuentas"
            className="h-9 w-full sm:w-72"
          />
        }
      />

      {query.isLoading && <PageLoader />}
      {query.error && (
        <ErrorState
          title="No se pudo cargar el plan de cuentas"
          description={(query.error as Error).message}
          action={<Button onClick={() => void query.refetch()}>Reintentar</Button>}
        />
      )}

      {query.data && (
        <>
          <div className="card p-2">
            <ul className="text-sm">{query.data.map((node) => renderNode(node, 0))}</ul>
            {term && query.data.every((n) => !visible(n)) && (
              <p className="px-3 py-8 text-center text-sm text-fg-muted">
                Ninguna cuenta coincide con «{search}».
              </p>
            )}
          </div>

          <p className="flex items-start gap-2 text-xs text-fg-subtle">
            <Landmark className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              En el PUC la jerarquía es el código: un dígito es la clase, dos el grupo, cuatro la
              cuenta y seis la subcuenta. Solo las hojas reciben movimiento; las demás suman lo de
              sus hijas.
            </span>
          </p>
        </>
      )}
    </>
  );
}
