import { AppError, Decimal } from '@erp/core';

/**
 * Estado del ciclo de compra.
 *
 * Se DERIVA de lo recibido, no se guarda. Un estado almacenado se desincroniza
 * en cuanto una recepción se anula, y entonces la orden dice "recibida" con
 * mercancía pendiente: nadie reclama al proveedor y la mercancía nunca llega.
 */

export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

export interface OrderLineProgress {
  quantity: Decimal.Value;
  received: Decimal.Value;
}

export const deriveOrderStatus = (
  stored: PurchaseOrderStatus,
  lines: readonly OrderLineProgress[],
): PurchaseOrderStatus => {
  // Borrador y cancelada no dependen de lo recibido: son decisiones, no hechos.
  if (stored === 'DRAFT' || stored === 'CANCELLED') return stored;
  if (lines.length === 0) return stored;

  const ordered = lines.reduce((a, l) => a.plus(l.quantity), new Decimal(0));
  const received = lines.reduce((a, l) => a.plus(l.received), new Decimal(0));

  if (received.isZero()) return 'SENT';
  if (received.greaterThanOrEqualTo(ordered)) return 'RECEIVED';
  return 'PARTIAL';
};

export const PURCHASE_ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviada',
  PARTIAL: 'Recibida en parte',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
};

/** Lo que falta por recibir de una línea. Nunca negativo. */
export const pendingOf = (line: OrderLineProgress): Decimal => {
  const pending = new Decimal(line.quantity).minus(line.received);
  return pending.isNegative() ? new Decimal(0) : pending;
};

/**
 * Recibir de más.
 *
 * Se PERMITE, con tolerancia: los proveedores despachan de más por empaque —una
 * caja de 12 cuando se pidieron 10— y rechazar la recepción obligaría a
 * modificar la orden para reflejar algo que ya está en la bodega. Lo que no se
 * permite es que pase desapercibido: por encima de la tolerancia hay que
 * ampliar la orden a propósito.
 */
export const OVER_RECEIPT_TOLERANCE_PERCENT = 10;

export const assertWithinOrder = (
  line: OrderLineProgress,
  incoming: Decimal.Value,
  description: string,
): void => {
  const ordered = new Decimal(line.quantity);
  const total = new Decimal(line.received).plus(incoming);
  const limit = ordered.times(100 + OVER_RECEIPT_TOLERANCE_PERCENT).dividedBy(100);

  if (total.greaterThan(limit)) {
    throw AppError.rule(
      `De "${description}" se pidieron ${ordered.toFixed(2)} y con esta recepción llegarían ` +
        `${total.toFixed(2)}, más del ${OVER_RECEIPT_TOLERANCE_PERCENT} % de tolerancia. ` +
        'Amplía la orden de compra si el proveedor despachó de más a propósito.',
    );
  }
};

/**
 * Contraste entre lo pedido, lo recibido y lo facturado.
 *
 * Es el control que justifica tener tres documentos separados: cuando los tres
 * coinciden no hay nada que revisar, y cuando no, aquí se ve exactamente dónde
 * está la diferencia. Con un único documento "compra" esa diferencia no existe
 * y se paga de más sin que nadie se entere.
 */
export interface ThreeWayMatch {
  ordered: string;
  received: string;
  billed: string;
  matches: boolean;
  issues: string[];
}

export const threeWayMatch = (input: {
  ordered: Decimal.Value;
  received: Decimal.Value;
  billed: Decimal.Value;
  description: string;
}): ThreeWayMatch => {
  const ordered = new Decimal(input.ordered);
  const received = new Decimal(input.received);
  const billed = new Decimal(input.billed);
  const issues: string[] = [];

  if (billed.greaterThan(received)) {
    issues.push(
      `Facturan ${billed.toFixed(2)} de "${input.description}" y solo llegaron ` +
        `${received.toFixed(2)}: hay ${billed.minus(received).toFixed(2)} sin recibir`,
    );
  }
  if (received.lessThan(ordered)) {
    issues.push(
      `De "${input.description}" faltan ${ordered.minus(received).toFixed(2)} por llegar`,
    );
  }
  if (received.greaterThan(ordered)) {
    issues.push(
      `De "${input.description}" llegaron ${received.minus(ordered).toFixed(2)} de más`,
    );
  }

  return {
    ordered: ordered.toFixed(6),
    received: received.toFixed(6),
    billed: billed.toFixed(6),
    matches: issues.length === 0,
    issues,
  };
};
