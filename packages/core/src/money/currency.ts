/**
 * Registro de monedas. `decimals` es la escala de redondeo contable;
 * `displayDecimals` la que se muestra al usuario (en Colombia los pesos se
 * presentan sin decimales aunque se contabilicen con dos).
 */
export interface CurrencyDef {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
  displayDecimals: number;
}

export const CURRENCIES: Record<string, CurrencyDef> = {
  COP: { code: 'COP', name: 'Peso colombiano', symbol: '$', decimals: 2, displayDecimals: 0 },
  USD: { code: 'USD', name: 'Dólar estadounidense', symbol: 'US$', decimals: 2, displayDecimals: 2 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, displayDecimals: 2 },
  MXN: { code: 'MXN', name: 'Peso mexicano', symbol: 'MX$', decimals: 2, displayDecimals: 2 },
  PEN: { code: 'PEN', name: 'Sol peruano', symbol: 'S/', decimals: 2, displayDecimals: 2 },
  CLP: { code: 'CLP', name: 'Peso chileno', symbol: 'CLP$', decimals: 0, displayDecimals: 0 },
  ARS: { code: 'ARS', name: 'Peso argentino', symbol: 'AR$', decimals: 2, displayDecimals: 2 },
  BRL: { code: 'BRL', name: 'Real brasileño', symbol: 'R$', decimals: 2, displayDecimals: 2 },
};

export const currencyOf = (code: string): CurrencyDef =>
  CURRENCIES[code] ?? { code, name: code, symbol: code, decimals: 2, displayDecimals: 2 };
