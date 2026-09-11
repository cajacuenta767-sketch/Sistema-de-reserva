import type { Tone } from '@/design-system';
import type { MoveKind } from './types';

/** El usuario no lee `RECEIPT` ni `TRANSFER_OUT`: lee qué pasó. */
export const MOVE_KIND: Record<MoveKind, { label: string; tone: Tone }> = {
  RECEIPT: { label: 'Entrada por compra', tone: 'success' },
  ISSUE: { label: 'Salida por venta', tone: 'accent' },
  ADJUSTMENT: { label: 'Ajuste', tone: 'warning' },
  TRANSFER_IN: { label: 'Entrada por traslado', tone: 'info' },
  TRANSFER_OUT: { label: 'Salida por traslado', tone: 'info' },
  RETURN_IN: { label: 'Devolución de cliente', tone: 'success' },
  RETURN_OUT: { label: 'Devolución a proveedor', tone: 'warning' },
  OPENING: { label: 'Saldo inicial', tone: 'neutral' },
  COUNT: { label: 'Ajuste por conteo', tone: 'warning' },
};

export const COUNT_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  COUNTING: { label: 'En curso', tone: 'accent' },
  APPLIED: { label: 'Aplicado', tone: 'success' },
  CANCELLED: { label: 'Cancelado', tone: 'neutral' },
};

/** De dónde salió un movimiento, y a dónde lleva el enlace. */
export const MOVE_SOURCE: Record<string, { label: string; path: string }> = {
  sales_invoice: { label: 'Factura de venta', path: '/facturas' },
  goods_receipt: { label: 'Recepción', path: '/compras/recepciones' },
  MANUAL: { label: 'Manual', path: '' },
};
