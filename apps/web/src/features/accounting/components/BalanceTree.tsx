import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { amount } from '@/lib/format';
import { LEVEL_NAME } from '../lib/labels';
import type { BalanceNode } from '../lib/types';

/**
 * Árbol de saldos del PUC.
 *
 * Arranca mostrando solo clases y grupos. Un plan de cuentas colombiano tiene
 * cientos de subcuentas, y desplegarlo entero convierte el informe en un muro
 * de cifras donde no se distingue lo importante: quien quiera el detalle de una
 * cuenta la abre.
 */

interface Props {
  nodes: readonly BalanceNode[];
  /** Niveles desplegados de inicio. 2 = clases y grupos. */
  initialDepth?: number;
  showOpening?: boolean;
  emptyLabel?: string;
}

interface RowProps {
  node: BalanceNode;
  depth: number;
  expanded: Set<string>;
  toggle: (code: string) => void;
  showOpening: boolean;
}

function Row({ node, depth, expanded, toggle, showOpening }: RowProps) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.code);
  const heading = !node.isPostable;

  return (
    <>
      <tr className={heading ? 'bg-surface-2/60 font-medium' : undefined}>
        <th
          scope="row"
          className="px-3 py-1.5 text-left font-normal"
          style={{ paddingLeft: `${0.75 + depth * 1.1}rem` }}
        >
          <span className="flex items-center gap-1.5">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggle(node.code)}
                className="rounded p-0.5 text-fg-muted hover:bg-surface-3 hover:text-fg"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Contraer' : 'Desplegar'} ${node.code} ${node.name}`}
              >
                {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
            ) : (
              <span className="inline-block size-4" aria-hidden="true" />
            )}
            <span className="font-mono text-xs text-fg-muted">{node.code}</span>
            <span className={heading ? 'font-medium' : ''}>{node.name}</span>
            {heading && (
              <span className="sr-only">{LEVEL_NAME[node.level] ?? 'Agrupación'}</span>
            )}
          </span>
        </th>
        {showOpening && (
          <td className="px-3 py-1.5 text-right tabular-nums text-fg-muted">
            {amount(node.openingBalance, 0)}
          </td>
        )}
        <td className="px-3 py-1.5 text-right tabular-nums">{amount(node.debit, 0)}</td>
        <td className="px-3 py-1.5 text-right tabular-nums">{amount(node.credit, 0)}</td>
        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
          {amount(node.closingBalance, 0)}
        </td>
      </tr>
      {isOpen &&
        node.children.map((child) => (
          <Row
            key={child.code}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            showOpening={showOpening}
          />
        ))}
    </>
  );
}

const codesUpTo = (nodes: readonly BalanceNode[], depth: number): string[] =>
  depth <= 0
    ? []
    : nodes.flatMap((n) => [n.code, ...codesUpTo(n.children, depth - 1)]);

export function BalanceTree({
  nodes,
  initialDepth = 2,
  showOpening = false,
  emptyLabel = 'Sin movimiento en el periodo',
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(codesUpTo(nodes, initialDepth)),
  );

  const toggle = (code: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  if (nodes.length === 0) {
    return <p className="px-3 py-6 text-center text-sm text-fg-muted">{emptyLabel}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-surface-2 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Cuenta</th>
            {showOpening && <th className="px-3 py-2 text-right font-medium">Saldo anterior</th>}
            <th className="px-3 py-2 text-right font-medium">Débitos</th>
            <th className="px-3 py-2 text-right font-medium">Créditos</th>
            <th className="px-3 py-2 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {nodes.map((node) => (
            <Row
              key={node.code}
              node={node}
              depth={0}
              expanded={expanded}
              toggle={toggle}
              showOpening={showOpening}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
