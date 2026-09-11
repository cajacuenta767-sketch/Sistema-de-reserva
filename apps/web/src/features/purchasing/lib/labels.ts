import type { Tone } from '@/design-system';

export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  SENT: { label: 'Enviada', tone: 'accent' },
  PARTIAL: { label: 'Recibida en parte', tone: 'warning' },
  RECEIVED: { label: 'Recibida', tone: 'success' },
  CANCELLED: { label: 'Cancelada', tone: 'neutral' },
};

export const RECEIPT_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  POSTED: { label: 'Contabilizada', tone: 'success' },
  VOID: { label: 'Anulada', tone: 'danger' },
};

export const BILL_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  POSTED: { label: 'Por pagar', tone: 'accent' },
  PARTIAL: { label: 'Pagada en parte', tone: 'warning' },
  PAID: { label: 'Pagada', tone: 'success' },
  OVERDUE: { label: 'Vencida', tone: 'danger' },
  VOID: { label: 'Anulada', tone: 'neutral' },
};

/** Tramos de las cuentas por pagar. Los mismos que usa cualquier tesorería. */
export const PAYABLE_COLUMNS = [
  { key: 'current', label: 'Por vencer' },
  { key: 'd1_30', label: '1-30 días' },
  { key: 'd31_60', label: '31-60' },
  { key: 'd61_90', label: '61-90' },
  { key: 'd90_plus', label: 'Más de 90' },
] as const;
