/** Vocabulario compartido por las pantallas de catálogo. */

export const PRODUCT_KINDS = [
  { value: 'GOOD', label: 'Bien' },
  { value: 'SERVICE', label: 'Servicio' },
  { value: 'KIT', label: 'Kit' },
] as const;

export const TAX_KINDS = [
  { value: 'VAT', label: 'IVA' },
  { value: 'INC', label: 'Impuesto al consumo' },
  { value: 'WITHHOLDING_INCOME', label: 'ReteFuente' },
  { value: 'WITHHOLDING_VAT', label: 'ReteIVA' },
  { value: 'WITHHOLDING_ICA', label: 'ReteICA' },
  { value: 'OTHER', label: 'Otro' },
] as const;

export const DIMENSIONS = [
  { value: 'UNIT', label: 'Unidades' },
  { value: 'WEIGHT', label: 'Peso' },
  { value: 'VOLUME', label: 'Volumen' },
  { value: 'LENGTH', label: 'Longitud' },
  { value: 'AREA', label: 'Superficie' },
  { value: 'TIME', label: 'Tiempo' },
] as const;

export const TRACKING_MODES = [
  { value: 'NONE', label: 'Sin trazabilidad' },
  { value: 'LOT', label: 'Por lote' },
  { value: 'SERIAL', label: 'Por número de serie' },
] as const;

const label = (list: ReadonlyArray<{ value: string; label: string }>, value: string): string =>
  list.find((i) => i.value === value)?.label ?? value;

export const productKindLabel = (value: string): string => label(PRODUCT_KINDS, value);
export const taxKindLabel = (value: string): string => label(TAX_KINDS, value);
export const dimensionLabel = (value: string): string => label(DIMENSIONS, value);
export const trackingLabel = (value: string): string => label(TRACKING_MODES, value);

/** Tarifa como la escribe la DIAN: "19 %". El ReteICA va por mil aparte. */
export const rateLabel = (rate: string, kind?: string): string =>
  kind === 'WITHHOLDING_ICA'
    ? `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(Number(rate) * 10)} × 1000`
    : `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(Number(rate))} %`;

export const COST_METHODS = [
  { value: 'AVERAGE', label: 'Costo promedio' },
  { value: 'FIFO', label: 'FIFO (primero en entrar, primero en salir)' },
  { value: 'STANDARD', label: 'Costo estándar' },
] as const;

export const costMethodLabel = (value: string): string => label(COST_METHODS, value);
