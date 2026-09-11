/** Vocabulario de ventas, en castellano y con el tono que usa la pantalla. */

import type { InvoiceStatus, QuoteStatus } from './types';

export const INVOICE_STATUS: Record<
  InvoiceStatus,
  { label: string; tone: 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  ISSUED: { label: 'Emitida', tone: 'info' },
  PARTIALLY_PAID: { label: 'Abonada', tone: 'warning' },
  PAID: { label: 'Pagada', tone: 'success' },
  OVERDUE: { label: 'Vencida', tone: 'danger' },
  VOID: { label: 'Anulada', tone: 'neutral' },
};

export const QUOTE_STATUS: Record<
  QuoteStatus,
  { label: string; tone: 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  SENT: { label: 'Enviada', tone: 'info' },
  ACCEPTED: { label: 'Aceptada', tone: 'success' },
  REJECTED: { label: 'Rechazada', tone: 'danger' },
  EXPIRED: { label: 'Vencida', tone: 'warning' },
  CONVERTED: { label: 'Facturada', tone: 'accent' },
};

export const PAYMENT_METHODS = [
  { value: 'TRANSFER', label: 'Transferencia' },
  { value: 'CASH', label: 'Efectivo' },
  { value: 'CARD', label: 'Tarjeta' },
  { value: 'CHECK', label: 'Cheque' },
  { value: 'OTHER', label: 'Otro' },
] as const;

export const paymentMethodLabel = (value: string): string =>
  PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;

/** Tramos de la cartera, en el orden en que se leen. */
export const AGING_COLUMNS = [
  { key: 'current', label: 'Por vencer' },
  { key: 'd1_30', label: '1-30 días' },
  { key: 'd31_60', label: '31-60' },
  { key: 'd61_90', label: '61-90' },
  { key: 'd90_plus', label: '+90' },
] as const;
