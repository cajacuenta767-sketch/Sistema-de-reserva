import { format, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Formato de presentación.
 *
 * El dinero llega de la API como string exacto (`{ amount, currency }`) y aquí
 * se convierte a `number` SOLO para mostrarlo. Nunca se opera con ese número:
 * los cálculos ocurren en el servidor con aritmética decimal.
 */

export interface MoneyValue {
  amount: string;
  currency: string;
}

/** El peso colombiano se presenta sin decimales aunque se contabilice con dos. */
const DISPLAY_DECIMALS: Record<string, number> = { COP: 0, CLP: 0, JPY: 0 };

export const money = (value: MoneyValue | string | null | undefined, currency = 'COP'): string => {
  if (value === null || value === undefined) return '—';
  const amount = typeof value === 'string' ? value : value.amount;
  const code = typeof value === 'string' ? currency : value.currency;
  const decimals = DISPLAY_DECIMALS[code] ?? 2;

  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(amount));
};

/** Importe sin símbolo, para columnas donde la moneda va en la cabecera. */
export const amount = (value: string | number | null | undefined, decimals = 2): string =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('es-CO', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(Number(value));

export const number = (value: number | string | null | undefined): string =>
  value === null || value === undefined ? '—' : new Intl.NumberFormat('es-CO').format(Number(value));

export const percent = (value: number | null | undefined, decimals = 0): string =>
  value === null || value === undefined
    ? '—'
    : new Intl.NumberFormat('es-CO', {
        style: 'percent',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value / 100);

const toDate = (value: Date | string): Date => (typeof value === 'string' ? parseISO(value) : value);

export const date = (value: Date | string | null | undefined): string =>
  value ? format(toDate(value), "d 'de' MMM yyyy", { locale: es }) : '—';

export const dateShort = (value: Date | string | null | undefined): string =>
  value ? format(toDate(value), 'dd/MM/yyyy', { locale: es }) : '—';

export const dateTime = (value: Date | string | null | undefined): string =>
  value ? format(toDate(value), 'd MMM yyyy · HH:mm', { locale: es }) : '—';

export const relative = (value: Date | string | null | undefined): string =>
  value ? formatDistanceToNowStrict(toDate(value), { locale: es, addSuffix: true }) : '—';

export const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();
