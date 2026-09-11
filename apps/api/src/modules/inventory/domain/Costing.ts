import { AppError, Decimal, Money } from '@erp/core';

/**
 * Costeo de inventario.
 *
 * Aquí se decide cuánto vale lo que hay en bodega y cuánto cuesta lo que sale,
 * que es la mitad de la utilidad de la empresa. Un costo mal calculado no da
 * ningún error: da una utilidad equivocada durante meses, y cuando se descubre
 * ya se declaró.
 *
 * Todo es función pura sobre `Decimal`. Con `number`, un promedio ponderado de
 * tres entradas ya arrastra error de coma flotante, y ese error se multiplica
 * por cada unidad que sale.
 */

/** Escala de las cantidades en la base: `numeric(19,6)`. */
export const QTY_DECIMALS = 6;
/** Escala del dinero: `numeric(19,4)`. */
export const COST_DECIMALS = 4;

export interface StockState {
  /** Existencias antes del movimiento. Puede ser negativa: ver `applyIssue`. */
  quantity: Decimal;
  /** Costo promedio ponderado vigente. */
  averageCost: Decimal;
}

export interface CostedMove {
  quantity: Decimal;
  unitCost: Decimal;
  totalCost: Decimal;
  balanceAfter: Decimal;
  averageAfter: Decimal;
}

export const emptyState = (): StockState => ({
  quantity: new Decimal(0),
  averageCost: new Decimal(0),
});

/**
 * Entrada: promedio ponderado.
 *
 *   nuevo promedio = (valor existente + valor que entra) / (unidades totales)
 *
 * Se pondera por VALOR, no por precio: promediar los dos precios a secas daría
 * el mismo peso a una entrada de 1 unidad que a otra de 1.000, y bastaría una
 * compra pequeña y cara para inflar el costo de toda la bodega.
 *
 * Cuando las existencias previas son negativas —se vendió lo que aún no había
 * llegado— el promedio anterior no significa nada, así que la entrada FIJA el
 * costo en lugar de promediarlo. Promediar contra una base negativa produce
 * costos negativos, que después aparecen como utilidades imposibles.
 */
export const applyReceipt = (
  state: StockState,
  quantity: Decimal.Value,
  unitCost: Decimal.Value,
): CostedMove => {
  const qty = new Decimal(quantity);
  if (qty.lessThanOrEqualTo(0)) {
    throw AppError.validation('Una entrada de inventario tiene que ser positiva');
  }
  const cost = new Decimal(unitCost);
  if (cost.isNegative()) throw AppError.validation('El costo de una entrada no puede ser negativo');

  const balanceAfter = state.quantity.plus(qty);

  const averageAfter = (() => {
    if (balanceAfter.lessThanOrEqualTo(0)) return cost;
    if (state.quantity.lessThanOrEqualTo(0)) return cost;
    const existingValue = state.quantity.times(state.averageCost);
    const incomingValue = qty.times(cost);
    return existingValue.plus(incomingValue).dividedBy(balanceAfter);
  })();

  return {
    quantity: qty,
    unitCost: cost,
    totalCost: qty.times(cost).toDecimalPlaces(COST_DECIMALS, Decimal.ROUND_HALF_UP),
    balanceAfter,
    averageAfter: averageAfter.toDecimalPlaces(COST_DECIMALS, Decimal.ROUND_HALF_UP),
  };
};

/**
 * Salida: sale al promedio vigente y el promedio NO cambia.
 *
 * Es la propiedad que define el promedio ponderado: vender no altera lo que
 * costó lo que queda. Recalcularlo en la salida —error habitual— hace que el
 * costo dependa del orden en que se despacha.
 */
export const applyIssue = (state: StockState, quantity: Decimal.Value): CostedMove => {
  const qty = new Decimal(quantity).abs();
  if (qty.lessThanOrEqualTo(0)) {
    throw AppError.validation('Una salida de inventario tiene que ser positiva');
  }

  const balanceAfter = state.quantity.minus(qty);
  return {
    quantity: qty.negated(),
    unitCost: state.averageCost,
    totalCost: qty.times(state.averageCost).toDecimalPlaces(COST_DECIMALS, Decimal.ROUND_HALF_UP).negated(),
    balanceAfter,
    averageAfter: state.averageCost,
  };
};

/**
 * Ajuste de conteo: lleva las existencias a lo contado.
 *
 * Lo que sobra entra al promedio vigente —no hay factura que diga otra cosa— y
 * lo que falta sale a ese mismo promedio. Así el ajuste corrige la cantidad sin
 * tocar el costo, que es lo que un conteo mide: unidades, no precios.
 */
export const applyCount = (state: StockState, counted: Decimal.Value): CostedMove | null => {
  const target = new Decimal(counted);
  if (target.isNegative()) throw AppError.validation('Un conteo no puede ser negativo');

  const difference = target.minus(state.quantity);
  // Sin diferencia no hay movimiento: un ajuste de cero ensucia el kardex y
  // hace creer que algo pasó.
  if (difference.isZero()) return null;

  return {
    quantity: difference,
    unitCost: state.averageCost,
    totalCost: difference
      .times(state.averageCost)
      .toDecimalPlaces(COST_DECIMALS, Decimal.ROUND_HALF_UP),
    balanceAfter: target,
    averageAfter: state.averageCost,
  };
};

/**
 * ¿Alcanza el stock disponible?
 *
 * Disponible = existencias − reservado. Lo reservado ya está comprometido con
 * otro pedido: contarlo como disponible hace que dos vendedores prometan la
 * misma unidad y uno de los dos quede mal con su cliente.
 */
export interface Availability {
  quantity: Decimal;
  reserved: Decimal;
}

export const availableOf = (level: Availability): Decimal => level.quantity.minus(level.reserved);

export const assertEnoughStock = (
  level: Availability,
  wanted: Decimal.Value,
  label: string,
  allowNegative: boolean,
): void => {
  if (allowNegative) return;
  const available = availableOf(level);
  const qty = new Decimal(wanted);
  if (available.lessThan(qty)) {
    throw AppError.rule(
      `No hay existencias suficientes de ${label}: se piden ${qty.toFixed(2)} y hay ` +
        `${available.toFixed(2)} disponibles` +
        (level.reserved.greaterThan(0)
          ? ` (${level.reserved.toFixed(2)} están reservadas para otros pedidos)`
          : ''),
    );
  }
};

/** Valor del inventario: existencias por su costo promedio. */
export const stockValue = (state: StockState, currency: string): Money =>
  Money.of(
    state.quantity.times(state.averageCost).toDecimalPlaces(COST_DECIMALS, Decimal.ROUND_HALF_UP),
    currency,
  );

/**
 * Reparte costos indirectos —flete, seguro, nacionalización— entre las líneas
 * de una recepción, en proporción a su valor.
 *
 * En proporción al VALOR y no a las unidades: un contenedor con 1.000 tornillos
 * y 10 motores repartido por unidades cargaría casi todo el flete a los
 * tornillos, y el costo de cada tornillo se multiplicaría por veinte.
 */
export const allocateLandedCost = (
  lineValues: readonly Decimal.Value[],
  extraCost: Money,
): Money[] => {
  const weights = lineValues.map((v) => new Decimal(v));
  return extraCost.allocate(weights, COST_DECIMALS);
};
