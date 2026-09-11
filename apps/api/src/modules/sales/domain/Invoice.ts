import type { Money } from '@erp/core';
import { AppError, Decimal } from '@erp/core';

/**
 * Estados de un documento de venta y las reglas que los gobiernan.
 *
 * Una factura emitida NO se edita ni se borra: se anula o se corrige con una
 * nota de crédito. Es lo que permite que el consecutivo no tenga huecos y que
 * la contabilidad del mes pasado siga cuadrando hoy.
 */

export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'OVERDUE';

const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  DRAFT: ['SENT', 'ACCEPTED', 'REJECTED'],
  SENT: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  // Aceptada y luego rechazada: el cliente se echa atrás antes de facturar.
  ACCEPTED: ['CONVERTED', 'REJECTED', 'EXPIRED'],
  REJECTED: ['DRAFT'],
  EXPIRED: ['DRAFT'],
  CONVERTED: [],
};

export const canTransitionQuote = (from: QuoteStatus, to: QuoteStatus): boolean =>
  QUOTE_TRANSITIONS[from].includes(to);

export const assertQuoteTransition = (from: QuoteStatus, to: QuoteStatus): void => {
  if (!canTransitionQuote(from, to)) {
    throw AppError.rule(
      from === 'CONVERTED'
        ? 'Esta cotización ya se convirtió en factura: crea una nueva'
        : `Una cotización ${QUOTE_LABEL[from]} no puede pasar a ${QUOTE_LABEL[to]}`,
    );
  }
};

const QUOTE_LABEL: Record<QuoteStatus, string> = {
  DRAFT: 'en borrador',
  SENT: 'enviada',
  ACCEPTED: 'aceptada',
  REJECTED: 'rechazada',
  EXPIRED: 'vencida',
  CONVERTED: 'convertida',
};

/**
 * Estado de una factura a partir de lo pagado.
 *
 * Se DERIVA del saldo en vez de guardarse como un campo que alguien actualiza:
 * un estado almacenado se desincroniza en cuanto un pago se anula por otra vía,
 * y entonces la factura dice "pagada" con saldo pendiente.
 */
export const deriveInvoiceStatus = (input: {
  issued: boolean;
  voided: boolean;
  total: Money;
  paid: Money;
  dueDate: string;
  today: string;
}): InvoiceStatus => {
  if (input.voided) return 'VOID';
  if (!input.issued) return 'DRAFT';

  const total = new Decimal(input.total.amount);
  const paid = new Decimal(input.paid.amount);

  if (paid.greaterThanOrEqualTo(total) && total.greaterThan(0)) return 'PAID';
  // Vencida gana sobre parcialmente pagada: lo que hay que ver en la cartera es
  // que el plazo ya pasó, no que se abonó algo.
  if (input.dueDate < input.today) return 'OVERDUE';
  if (paid.greaterThan(0)) return 'PARTIALLY_PAID';
  return 'ISSUED';
};

/** Una factura emitida solo se puede anular si nadie ha pagado nada. */
export const assertCanVoid = (input: { status: InvoiceStatus; paid: Money }): void => {
  if (input.status === 'VOID') throw AppError.rule('Esta factura ya está anulada');
  if (input.status === 'DRAFT') return;
  if (new Decimal(input.paid.amount).greaterThan(0)) {
    throw AppError.rule(
      'Esta factura tiene pagos registrados: anúlala con una nota de crédito para que ' +
        'el dinero recibido quede justificado',
    );
  }
};

/** Una factura emitida es inmutable. Corregirla es emitir una nota de crédito. */
export const assertEditable = (status: InvoiceStatus): void => {
  if (status !== 'DRAFT') {
    throw AppError.rule(
      'Una factura emitida no se puede modificar: corrígela con una nota de crédito. ' +
        'Cambiarla dejaría la contabilidad del periodo sin cuadrar.',
    );
  }
};

/**
 * Vencimiento a partir de la fecha del documento y el plazo del cliente.
 *
 * Se calcula sobre la fecha de EMISIÓN, no sobre hoy: refacturar en marzo un
 * documento de enero tiene que dar el vencimiento de enero.
 */
export const dueDateFrom = (issueDate: string, paymentTermsDays: number): string => {
  const date = new Date(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw AppError.rule(`Fecha inválida: ${issueDate}`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, paymentTermsDays));
  return date.toISOString().slice(0, 10);
};

/** Días de mora. Negativo significa que aún no vence. */
export const daysOverdue = (dueDate: string, today: string): number => {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  return Math.round((now - due) / 86_400_000);
};

/**
 * Tramo de antigüedad para el informe de cartera.
 *
 * Los cortes (30/60/90) son los que usa cualquier comité de cartera en Colombia:
 * más allá de 90 días la deuda se provisiona.
 */
export type AgingBucket = 'CURRENT' | 'D1_30' | 'D31_60' | 'D61_90' | 'D90_PLUS';

export const agingBucket = (dueDate: string, today: string): AgingBucket => {
  const days = daysOverdue(dueDate, today);
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return 'D1_30';
  if (days <= 60) return 'D31_60';
  if (days <= 90) return 'D61_90';
  return 'D90_PLUS';
};

export const AGING_LABEL: Record<AgingBucket, string> = {
  CURRENT: 'Por vencer',
  D1_30: '1 a 30 días',
  D31_60: '31 a 60 días',
  D61_90: '61 a 90 días',
  D90_PLUS: 'Más de 90 días',
};
