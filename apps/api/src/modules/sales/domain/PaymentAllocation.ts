import { AppError, Decimal, Money } from '@erp/core';

/**
 * Imputación de un pago a las facturas del cliente.
 *
 * Casi nunca llega un pago por el importe exacto de una factura: llega una
 * transferencia que cubre tres facturas y media, o un abono parcial. Decidir a
 * cuál se aplica no es un detalle administrativo, porque determina qué queda
 * vencido, sobre qué se cobran intereses y qué aparece en la cartera.
 *
 * La regla por defecto es la más antigua primero, que es la que evita que una
 * factura envejezca indefinidamente mientras se pagan las nuevas. Quien quiera
 * otra cosa imputa a mano, y entonces manda su lista.
 */

export interface OpenInvoice {
  id: string;
  number: string;
  issueDate: string;
  dueDate: string;
  total: Money;
  /** Ya pagado antes de este pago. */
  paid: Money;
}

export interface AllocationLine {
  invoiceId: string;
  number: string;
  amount: Money;
  /** Saldo de esa factura DESPUÉS de aplicar esta imputación. */
  remainingAfter: Money;
}

export interface AllocationResult {
  lines: AllocationLine[];
  applied: Money;
  /** Dinero del pago que no se pudo imputar: queda como saldo a favor. */
  unapplied: Money;
}

export const outstandingOf = (invoice: OpenInvoice): Money => invoice.total.minus(invoice.paid);

/**
 * Reparte un pago entre facturas abiertas, de la más antigua a la más reciente.
 *
 * El sobrante NO se fuerza sobre la última factura: queda explícito como saldo a
 * favor. Meterlo a la fuerza dejaría una factura "pagada de más", que es un
 * estado que la contabilidad no sabe representar y que aparece como un descuadre
 * al cerrar el mes.
 */
export const allocateOldestFirst = (amount: Money, invoices: readonly OpenInvoice[]): AllocationResult => {
  assertPositive(amount);

  const ordered = [...invoices]
    .filter((i) => new Decimal(outstandingOf(i).amount).greaterThan(0))
    .sort((a, b) => (a.dueDate === b.dueDate ? a.issueDate.localeCompare(b.issueDate) : a.dueDate.localeCompare(b.dueDate)));

  const currency = amount.currency;
  const lines: AllocationLine[] = [];
  let left = new Decimal(amount.amount);

  for (const invoice of ordered) {
    if (left.lessThanOrEqualTo(0)) break;
    const outstanding = new Decimal(outstandingOf(invoice).amount);
    const applied = Decimal.min(left, outstanding);

    lines.push({
      invoiceId: invoice.id,
      number: invoice.number,
      amount: Money.of(applied, currency),
      remainingAfter: Money.of(outstanding.minus(applied), currency),
    });
    left = left.minus(applied);
  }

  const applied = Money.of(new Decimal(amount.amount).minus(left), currency);
  return { lines, applied, unapplied: Money.of(left, currency) };
};

/**
 * Imputación indicada a mano.
 *
 * Se valida de verdad porque es donde se cuela el error caro: imputar más de lo
 * que la factura debe la deja con saldo negativo, y ese saldo no se ve hasta que
 * alguien cuadra la cartera meses después.
 */
export const allocateManually = (
  amount: Money,
  requested: ReadonlyArray<{ invoiceId: string; amount: string }>,
  invoices: readonly OpenInvoice[],
): AllocationResult => {
  assertPositive(amount);

  const byId = new Map(invoices.map((i) => [i.id, i]));
  const currency = amount.currency;
  const lines: AllocationLine[] = [];
  let total = new Decimal(0);

  for (const item of requested) {
    const invoice = byId.get(item.invoiceId);
    if (!invoice) throw AppError.rule(`La factura ${item.invoiceId} no está entre las abiertas de este cliente`);

    const value = new Decimal(item.amount);
    if (value.lessThanOrEqualTo(0)) {
      throw AppError.rule(`El importe imputado a la factura ${invoice.number} tiene que ser mayor que cero`);
    }

    const outstanding = new Decimal(outstandingOf(invoice).amount);
    if (value.greaterThan(outstanding)) {
      throw AppError.rule(
        `La factura ${invoice.number} debe ${format(outstanding)} y se le están imputando ` +
          `${format(value)}: quedaría pagada de más`,
      );
    }

    lines.push({
      invoiceId: invoice.id,
      number: invoice.number,
      amount: Money.of(value, currency),
      remainingAfter: Money.of(outstanding.minus(value), currency),
    });
    total = total.plus(value);
  }

  const paid = new Decimal(amount.amount);
  if (total.greaterThan(paid)) {
    throw AppError.rule(
      `Se están imputando ${format(total)} de un pago de ${format(paid)}: no se puede repartir más de lo recibido`,
    );
  }

  return {
    lines,
    applied: Money.of(total, currency),
    unapplied: Money.of(paid.minus(total), currency),
  };
};

const assertPositive = (amount: Money): void => {
  if (new Decimal(amount.amount).lessThanOrEqualTo(0)) {
    throw AppError.rule('El importe del pago tiene que ser mayor que cero');
  }
};

const format = (value: Decimal): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(
    value.toNumber(),
  );
