import { AppError } from '@erp/core';
import type { LocalDate } from '@erp/core';

/**
 * Tipos de movimiento y las reglas que dependen solo del tipo.
 *
 * El signo va DENTRO de la cantidad, no en un campo aparte. Guardar "cantidad
 * 10, sentido salida" obliga a recordar el signo en cada suma del kardex, y
 * basta olvidarlo una vez para que el saldo salga al revés sin que nada falle.
 */

export type MoveKind =
  | 'RECEIPT'
  | 'ISSUE'
  | 'ADJUSTMENT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'OPENING'
  | 'COUNT';

const INBOUND: readonly MoveKind[] = ['RECEIPT', 'TRANSFER_IN', 'RETURN_IN', 'OPENING'];
const OUTBOUND: readonly MoveKind[] = ['ISSUE', 'TRANSFER_OUT', 'RETURN_OUT'];

export const MOVE_LABEL: Record<MoveKind, string> = {
  RECEIPT: 'Entrada por compra',
  ISSUE: 'Salida por venta',
  ADJUSTMENT: 'Ajuste',
  TRANSFER_IN: 'Entrada por traslado',
  TRANSFER_OUT: 'Salida por traslado',
  RETURN_IN: 'Devolución de cliente',
  RETURN_OUT: 'Devolución a proveedor',
  OPENING: 'Saldo inicial',
  COUNT: 'Ajuste por conteo',
};

export const isInbound = (kind: MoveKind): boolean => INBOUND.includes(kind);
export const isOutbound = (kind: MoveKind): boolean => OUTBOUND.includes(kind);
/** `ADJUSTMENT` y `COUNT` van en los dos sentidos. */
export const isBidirectional = (kind: MoveKind): boolean => !isInbound(kind) && !isOutbound(kind);

/** El signo de la cantidad y el tipo tienen que decir lo mismo. */
export const assertSignMatchesKind = (kind: MoveKind, quantity: number | string): void => {
  const value = Number(quantity);
  if (value === 0) throw AppError.validation('Un movimiento de cero unidades no es un movimiento');
  if (isInbound(kind) && value < 0) {
    throw AppError.validation(`"${MOVE_LABEL[kind]}" suma existencias: la cantidad va en positivo`);
  }
  if (isOutbound(kind) && value > 0) {
    throw AppError.validation(`"${MOVE_LABEL[kind]}" resta existencias: la cantidad va en negativo`);
  }
};

/**
 * Un movimiento solo afecta a productos que llevan inventario.
 *
 * Un servicio no tiene existencias, y dejarlo pasar crearía un kardex de horas
 * de consultoría que nadie puede contar ni valorar.
 */
export const assertTracksInventory = (product: {
  name: string;
  kind: string;
  trackInventory: boolean;
}): void => {
  if (!product.trackInventory) {
    throw AppError.rule(
      `"${product.name}" no lleva control de existencias` +
        (product.kind === 'SERVICE' ? ': es un servicio' : ''),
    );
  }
};

/**
 * Un lote pertenece a su producto y no a otro.
 *
 * Sin esto, un error de teclado asigna el lote de un medicamento a otro y la
 * trazabilidad —que es justo para lo que existen los lotes— deja de servir
 * exactamente cuando hace falta, en una alerta sanitaria.
 */
export const assertLotBelongs = (
  lot: { id: string; code: string; productId: string } | null,
  productId: string,
  requiresLot: boolean,
  productName: string,
): void => {
  if (requiresLot && !lot) {
    throw AppError.rule(`"${productName}" se maneja por lotes: indica cuál`);
  }
  if (lot && lot.productId !== productId) {
    throw AppError.rule(`El lote ${lot.code} no pertenece a "${productName}"`);
  }
};

/** Un lote vencido no sale a vender. */
export const assertLotNotExpired = (
  lot: { code: string; expiresOn: LocalDate | null } | null,
  today: LocalDate,
): void => {
  if (lot?.expiresOn && lot.expiresOn < today) {
    throw AppError.rule(
      `El lote ${lot.code} venció el ${lot.expiresOn} y no puede despacharse. ` +
        'Dalo de baja con un ajuste si ya no es vendible.',
    );
  }
};

/**
 * Orden en que se consumen los lotes: primero el que vence antes.
 *
 * FEFO, no FIFO. En productos perecederos importa la fecha de VENCIMIENTO, no
 * la de entrada: un lote comprado ayer puede vencer antes que uno de hace un
 * mes, y sacar el más antiguo primero lo dejaría caducar en la estantería.
 * Los lotes sin vencimiento van al final, ordenados por entrada.
 */
export const lotsInPickingOrder = <
  T extends { expiresOn: LocalDate | null; createdAt: string | Date },
>(
  lots: readonly T[],
): T[] =>
  [...lots].sort((a, b) => {
    if (a.expiresOn && b.expiresOn) return a.expiresOn.localeCompare(b.expiresOn);
    if (a.expiresOn) return -1;
    if (b.expiresOn) return 1;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
