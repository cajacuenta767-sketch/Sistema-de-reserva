import { AppError, Decimal } from '@erp/core';

/**
 * Unidades de medida y conversión entre ellas.
 *
 * Todo el inventario se guarda en la unidad BASE del producto. Se compra por
 * caja, se vende por unidad y se cuenta por unidad, así que la conversión ocurre
 * en cada línea de cada documento. Es una multiplicación trivial y por eso mismo
 * es peligrosa: hecha a mano en cada pantalla, basta con olvidarla en una para
 * que el stock quede mal sin que nadie vea un error.
 */

export type UomDimension = 'UNIT' | 'WEIGHT' | 'VOLUME' | 'LENGTH' | 'AREA' | 'TIME';

export interface Uom {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  dimension: UomDimension;
  /** Cuántas unidades base vale una de ésta. */
  factor: string;
  precision: number;
  dianCode: string | null;
  isBase: boolean;
  isActive: boolean;
}

/** Cantidad expresada en una unidad concreta. Las dos cosas viajan juntas. */
export interface Quantity {
  amount: string;
  uom: Pick<Uom, 'id' | 'code' | 'dimension' | 'factor' | 'precision'>;
}

/**
 * Convierte una cantidad a otra unidad de la misma dimensión.
 *
 * Convertir entre dimensiones distintas no se redondea ni se aproxima: se
 * rechaza. Un ERP que acepte pasar kilos a metros devolverá un número, y ese
 * número acabará en una factura.
 */
export const convert = (quantity: Quantity, target: Quantity['uom']): string => {
  if (quantity.uom.dimension !== target.dimension) {
    throw AppError.rule(
      `No se puede convertir ${quantity.uom.code} a ${target.code}: miden cosas distintas ` +
        `(${quantity.uom.dimension} y ${target.dimension})`,
    );
  }
  if (quantity.uom.id === target.id) return quantity.amount;

  const inBase = new Decimal(quantity.amount).times(quantity.uom.factor);
  const converted = inBase.dividedBy(target.factor);
  return roundToPrecision(converted, target.precision);
};

/** Lleva una cantidad a la unidad base del producto, que es como se almacena. */
export const toBase = (quantity: Quantity, base: Quantity['uom']): string => convert(quantity, base);

/**
 * Redondea al número de decimales de la unidad.
 *
 * Hacia arriba (`ROUND_UP`) a propósito, y solo en el último decimal: si un
 * producto se vende por unidades enteras, despachar 2,4 cajas significa mover 3.
 * Redondear hacia abajo dejaría existencias fantasma que no se pueden despachar.
 */
export const roundToPrecision = (value: Decimal, precision: number): string =>
  value.toDecimalPlaces(precision, Decimal.ROUND_UP).toFixed(precision);

/** Una cantidad no entera en una unidad discreta es un dato imposible. */
export const assertRepresentable = (amount: string, uom: Pick<Uom, 'code' | 'precision'>): void => {
  const value = new Decimal(amount);
  if (value.decimalPlaces() > uom.precision) {
    throw AppError.rule(
      uom.precision === 0
        ? `${uom.code} no admite fracciones: ${amount} no es una cantidad válida`
        : `${uom.code} admite ${uom.precision} decimales: ${amount} tiene demasiados`,
    );
  }
};

/**
 * Unidades que trae una organización nueva.
 *
 * La primera de cada dimensión es la base (factor 1). Están los códigos UN/ECE
 * rec. 20 porque la factura electrónica DIAN los exige: sin ellos, la primera
 * factura que se emita es rechazada, y descubrirlo entonces obliga a revisar el
 * catálogo entero.
 */
export interface UomSeed {
  code: string;
  name: string;
  dimension: UomDimension;
  factor: string;
  precision: number;
  dianCode: string;
  isBase: boolean;
}

export const DEFAULT_UOMS: readonly UomSeed[] = [
  { code: 'UND', name: 'Unidad', dimension: 'UNIT', factor: '1', precision: 0, dianCode: 'EA', isBase: true },
  { code: 'PAR', name: 'Par', dimension: 'UNIT', factor: '2', precision: 0, dianCode: 'PR', isBase: false },
  { code: 'DOC', name: 'Docena', dimension: 'UNIT', factor: '12', precision: 0, dianCode: 'DZN', isBase: false },
  { code: 'CJ12', name: 'Caja x 12', dimension: 'UNIT', factor: '12', precision: 0, dianCode: 'BX', isBase: false },
  { code: 'CJ24', name: 'Caja x 24', dimension: 'UNIT', factor: '24', precision: 0, dianCode: 'BX', isBase: false },
  { code: 'G', name: 'Gramo', dimension: 'WEIGHT', factor: '1', precision: 2, dianCode: 'GRM', isBase: true },
  { code: 'KG', name: 'Kilogramo', dimension: 'WEIGHT', factor: '1000', precision: 3, dianCode: 'KGM', isBase: false },
  { code: 'LB', name: 'Libra', dimension: 'WEIGHT', factor: '453.592', precision: 3, dianCode: 'LBR', isBase: false },
  { code: 'TON', name: 'Tonelada', dimension: 'WEIGHT', factor: '1000000', precision: 3, dianCode: 'TNE', isBase: false },
  { code: 'ML', name: 'Mililitro', dimension: 'VOLUME', factor: '1', precision: 2, dianCode: 'MLT', isBase: true },
  { code: 'L', name: 'Litro', dimension: 'VOLUME', factor: '1000', precision: 3, dianCode: 'LTR', isBase: false },
  { code: 'GAL', name: 'Galón', dimension: 'VOLUME', factor: '3785.41', precision: 3, dianCode: 'GLL', isBase: false },
  { code: 'CM', name: 'Centímetro', dimension: 'LENGTH', factor: '1', precision: 2, dianCode: 'CMT', isBase: true },
  { code: 'M', name: 'Metro', dimension: 'LENGTH', factor: '100', precision: 3, dianCode: 'MTR', isBase: false },
  { code: 'KM', name: 'Kilómetro', dimension: 'LENGTH', factor: '100000', precision: 3, dianCode: 'KMT', isBase: false },
  { code: 'M2', name: 'Metro cuadrado', dimension: 'AREA', factor: '1', precision: 3, dianCode: 'MTK', isBase: true },
  { code: 'HORA', name: 'Hora', dimension: 'TIME', factor: '1', precision: 2, dianCode: 'HUR', isBase: true },
  { code: 'DIA', name: 'Día', dimension: 'TIME', factor: '24', precision: 2, dianCode: 'DAY', isBase: false },
  { code: 'MES', name: 'Mes', dimension: 'TIME', factor: '720', precision: 2, dianCode: 'MON', isBase: false },
];
