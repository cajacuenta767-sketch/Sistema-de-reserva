import { Decimal } from 'decimal.js';

/**
 * Punto único donde se configura la aritmética decimal del sistema.
 *
 * `decimal.js` guarda su precisión en un estado GLOBAL del módulo. Si cada
 * paquete lo importara por su cuenta y alguno llamara a `Decimal.set`, el
 * resultado dependería de qué copia se resolvió primero y de en qué orden se
 * cargaron los módulos: el mismo cálculo daría números distintos en la API y en
 * los tests, sin que nada fallara. Por eso el resto del monorepo importa
 * `Decimal` desde aquí y nunca de `decimal.js` directamente.
 *
 * 34 dígitos significativos (los de decimal128) para los pasos intermedios. Con
 * los 20 por defecto, una división encadenada en un prorrateo de descuentos
 * puede perder precisión antes del redondeo final, que es donde se decide el
 * peso que cuadra o no cuadra la factura. El redondeo a los decimales de la
 * moneda siempre se hace explícito, al final.
 */
Decimal.set({ precision: 34, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
