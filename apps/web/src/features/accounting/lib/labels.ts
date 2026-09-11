import type { Tone } from '@/design-system';
import type { AccountNature, AccountType } from './types';

/**
 * Etiquetas en castellano.
 *
 * Los enumerados del backend NUNCA se muestran en crudo. Un usuario que lee
 * "LIABILITY" en su plan de cuentas está leyendo una decisión de programación,
 * no información sobre su empresa.
 */

export const ACCOUNT_TYPE: Record<AccountType, { label: string; tone: Tone }> = {
  ASSET: { label: 'Activo', tone: 'accent' },
  LIABILITY: { label: 'Pasivo', tone: 'warning' },
  EQUITY: { label: 'Patrimonio', tone: 'info' },
  INCOME: { label: 'Ingreso', tone: 'success' },
  EXPENSE: { label: 'Gasto', tone: 'danger' },
  COST: { label: 'Costo', tone: 'danger' },
  MEMORANDUM: { label: 'Cuenta de orden', tone: 'neutral' },
};

export const ACCOUNT_NATURE: Record<AccountNature, string> = {
  DEBIT: 'Débito',
  CREDIT: 'Crédito',
};

/** Nombres del PUC para cada longitud de código. */
export const LEVEL_NAME: Record<number, string> = {
  1: 'Clase',
  2: 'Grupo',
  4: 'Cuenta',
  6: 'Subcuenta',
  8: 'Auxiliar',
};

export const JOURNAL_TYPE: Record<string, string> = {
  SALES: 'Ventas',
  PURCHASES: 'Compras',
  CASH: 'Caja y bancos',
  PAYROLL: 'Nómina',
  GENERAL: 'General',
  OPENING: 'Apertura',
  CLOSING: 'Cierre',
  INVENTORY: 'Inventario',
};

export const ENTRY_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Borrador', tone: 'neutral' },
  POSTED: { label: 'Contabilizado', tone: 'success' },
};

export const PERIOD_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'Abierto', tone: 'success' },
  CLOSED: { label: 'Cerrado', tone: 'neutral' },
};

/** De dónde salió un asiento, para mostrarlo sin exponer el nombre interno. */
export const SOURCE_LABEL: Record<string, string> = {
  sales_invoice: 'Factura de venta',
  credit_note: 'Nota de crédito',
  payment: 'Cobro',
  purchase_bill: 'Factura de compra',
  MANUAL: 'Asiento manual',
};
