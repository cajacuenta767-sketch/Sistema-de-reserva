import type { Money } from '@erp/core';
import type { EntryDraft, EntryLineDraft } from './JournalEntry.js';
import { assertBalanced, withoutZeroLines } from './JournalEntry.js';

/**
 * Motor de contabilización.
 *
 * Traduce un documento de negocio a un asiento. Es una función pura por tipo de
 * documento: entra una factura, sale un asiento cuadrado. Nada de base de
 * datos, nada de cuentas concretas —solo roles—, así que el asiento de una
 * factura colombiana con IVA y tres retenciones se prueba con una tabla de
 * casos y un total verificado a mano.
 *
 * Que sea puro es lo que permite la garantía de la fase: "emitir una factura
 * genera un asiento y el balance cuadra". Si contabilizar dependiera del estado
 * de la base de datos, esa frase solo se podría comprobar a posteriori, cuando
 * el descuadre ya está guardado.
 */

export interface InvoicePosting {
  number: string;
  date: string;
  partyId: string;
  partyName: string;
  currency: string;
  exchangeRate: string;
  branchId?: string | null;
  /** Base gravable: subtotal después de descuentos. */
  subtotal: Money;
  /** Ingreso separado por naturaleza, para llevarlo a su cuenta. */
  goodsRevenue: Money;
  servicesRevenue: Money;
  vat: Money;
  consumptionTax: Money;
  withholdingIncome: Money;
  withholdingVat: Money;
  withholdingIca: Money;
  total: Money;
}

/**
 * Factura de venta emitida.
 *
 *   Clientes                  total − retenciones
 *   ReteFuente por cobrar     retención en la fuente
 *   ReteIVA por cobrar        reteIVA
 *   ReteICA por cobrar        reteICA
 *        a  Ingresos                       base gravable
 *        a  IVA generado                   IVA
 *        a  INC por pagar                  INC
 *
 * Las retenciones NO reducen el ingreso ni el IVA: reducen lo que el cliente
 * transfiere y se convierten en un activo, porque son impuesto de renta pagado
 * por anticipado que se descuenta en la declaración. Contabilizarlas como menor
 * ingreso —el error habitual— subestima las ventas del año y descuadra el
 * formulario 110 con el estado de resultados.
 */
export const postSalesInvoice = (invoice: InvoicePosting): EntryDraft => {
  const currency = invoice.currency;
  const retained = invoice.withholdingIncome
    .plus(invoice.withholdingVat)
    .plus(invoice.withholdingIca);
  const receivable = invoice.total.minus(retained);
  const ref = invoice.number;

  const lines: EntryLineDraft[] = [
    {
      role: 'RECEIVABLES',
      side: 'DEBIT',
      amount: receivable,
      description: `Factura ${invoice.number} · ${invoice.partyName}`,
      partyId: invoice.partyId,
      branchId: invoice.branchId ?? null,
      reference: ref,
    },
    {
      role: 'WITHHOLDING_INCOME_ASSET',
      side: 'DEBIT',
      amount: invoice.withholdingIncome,
      description: `Retención en la fuente factura ${invoice.number}`,
      partyId: invoice.partyId,
      reference: ref,
    },
    {
      role: 'WITHHOLDING_VAT_ASSET',
      side: 'DEBIT',
      amount: invoice.withholdingVat,
      description: `ReteIVA factura ${invoice.number}`,
      partyId: invoice.partyId,
      reference: ref,
    },
    {
      role: 'WITHHOLDING_ICA_ASSET',
      side: 'DEBIT',
      amount: invoice.withholdingIca,
      description: `ReteICA factura ${invoice.number}`,
      partyId: invoice.partyId,
      reference: ref,
    },
    {
      role: 'SALES_GOODS',
      side: 'CREDIT',
      amount: invoice.goodsRevenue,
      description: `Venta de mercancías factura ${invoice.number}`,
      branchId: invoice.branchId ?? null,
      reference: ref,
    },
    {
      role: 'SALES_SERVICES',
      side: 'CREDIT',
      amount: invoice.servicesRevenue,
      description: `Servicios factura ${invoice.number}`,
      branchId: invoice.branchId ?? null,
      reference: ref,
    },
    {
      role: 'VAT_OUTPUT',
      side: 'CREDIT',
      amount: invoice.vat,
      description: `IVA generado factura ${invoice.number}`,
      reference: ref,
    },
    {
      role: 'CONSUMPTION_TAX',
      side: 'CREDIT',
      amount: invoice.consumptionTax,
      description: `Impuesto al consumo factura ${invoice.number}`,
      reference: ref,
    },
  ];

  const draft = withoutZeroLines({
    journalType: 'SALES',
    date: invoice.date,
    memo: `Factura de venta ${invoice.number} · ${invoice.partyName}`,
    sourceType: 'sales_invoice',
    sourceId: null,
    currency,
    exchangeRate: invoice.exchangeRate,
    lines,
  });
  assertBalanced(draft);
  return draft;
};

export interface PaymentPosting {
  number: string;
  date: string;
  partyId: string;
  partyName: string;
  currency: string;
  exchangeRate: string;
  amount: Money;
  /** Lo que salda facturas. */
  applied: Money;
  /** Lo que queda como saldo a favor del cliente. */
  unapplied: Money;
  method: 'CASH' | 'TRANSFER' | 'CARD' | 'CHECK' | 'OTHER';
  /** Facturas saldadas, para que el auxiliar diga cuál pagó qué. */
  invoiceNumbers: readonly string[];
}

/**
 * Cobro recibido.
 *
 *   Banco o caja              importe recibido
 *        a  Clientes                     imputado a facturas
 *        a  Anticipos de clientes        lo que sobra
 *
 * El sobrante va a un pasivo, no a "clientes en negativo". Una cartera con
 * saldo a favor es una deuda con el cliente: si mañana pide la devolución, hay
 * que pagarla. Dejarla restando de la cartera esconde tanto la deuda como la
 * cartera real.
 */
export const postPaymentIn = (payment: PaymentPosting): EntryDraft => {
  const cashRole = payment.method === 'CASH' ? ('CASH' as const) : ('BANK' as const);
  const ref = payment.number;
  const detail =
    payment.invoiceNumbers.length > 0 ? ` (${payment.invoiceNumbers.join(', ')})` : '';

  const lines: EntryLineDraft[] = [
    {
      role: cashRole,
      side: 'DEBIT',
      amount: payment.amount,
      description: `Cobro ${payment.number} · ${payment.partyName}`,
      reference: ref,
    },
    {
      role: 'RECEIVABLES',
      side: 'CREDIT',
      amount: payment.applied,
      description: `Abono a facturas${detail}`,
      partyId: payment.partyId,
      reference: ref,
    },
    {
      role: 'CUSTOMER_ADVANCES',
      side: 'CREDIT',
      amount: payment.unapplied,
      description: `Saldo a favor de ${payment.partyName}`,
      partyId: payment.partyId,
      reference: ref,
    },
  ];

  const draft = withoutZeroLines({
    journalType: 'CASH',
    date: payment.date,
    memo: `Recibo de caja ${payment.number} · ${payment.partyName}`,
    sourceType: 'payment',
    sourceId: null,
    currency: payment.currency,
    exchangeRate: payment.exchangeRate,
    lines,
  });
  assertBalanced(draft);
  return draft;
};

export interface CreditNotePosting {
  number: string;
  invoiceNumber: string;
  date: string;
  partyId: string;
  partyName: string;
  currency: string;
  exchangeRate: string;
  subtotal: Money;
  vat: Money;
  total: Money;
}

/**
 * Nota de crédito.
 *
 *   Devoluciones en ventas    base
 *   IVA generado              IVA
 *        a  Clientes                     total
 *
 * El ingreso no se resta de la cuenta de ventas: se lleva a una cuenta propia
 * de devoluciones. Restarlo directamente haría que las ventas del mes bajaran
 * sin dejar rastro, y nadie podría medir cuánto se devuelve.
 */
export const postCreditNote = (note: CreditNotePosting): EntryDraft => {
  const ref = note.number;
  const lines: EntryLineDraft[] = [
    {
      role: 'SALES_RETURNS',
      side: 'DEBIT',
      amount: note.subtotal,
      description: `Devolución nota ${note.number} sobre factura ${note.invoiceNumber}`,
      reference: ref,
    },
    {
      role: 'VAT_OUTPUT',
      side: 'DEBIT',
      amount: note.vat,
      description: `IVA de la nota ${note.number}`,
      reference: ref,
    },
    {
      role: 'RECEIVABLES',
      side: 'CREDIT',
      amount: note.total,
      description: `Nota de crédito ${note.number} · ${note.partyName}`,
      partyId: note.partyId,
      reference: ref,
    },
  ];

  const draft = withoutZeroLines({
    journalType: 'SALES',
    date: note.date,
    memo: `Nota de crédito ${note.number} · ${note.partyName}`,
    sourceType: 'credit_note',
    sourceId: null,
    currency: note.currency,
    exchangeRate: note.exchangeRate,
    lines,
  });
  assertBalanced(draft);
  return draft;
};
