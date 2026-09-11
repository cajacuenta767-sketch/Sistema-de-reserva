/** Entidad plana: sin métodos, sin ORM, sin herencia. Los comportamientos son
 *  funciones puras que operan sobre ella. */
export interface Organization {
  id: string;
  legalName: string;
  tradeName: string;
  taxId: string | null;
  taxIdDv: string | null;
  taxIdType: string;
  country: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  functionalCurrency: string;
  timezone: string;
  locale: string;
  fiscalYearStartMonth: number;
  brandHue: number | null;
  logoFileId: string | null;
  plan: 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  createdAt: Date;
  updatedAt: Date;
}

export interface Branch {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  isDefault: boolean;
  isActive: boolean;
}

/**
 * Dígito de verificación del NIT colombiano (DIAN).
 *
 * Función pura y verificable a mano: se prueba con NIT reales conocidos. Un NIT
 * con DV incorrecto rompe la facturación electrónica, y descubrirlo al emitir
 * la primera factura es tarde.
 */
const DV_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

export const nitCheckDigit = (nit: string): number => {
  const digits = nit.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > DV_WEIGHTS.length) {
    throw new Error(`NIT inválido: "${nit}"`);
  }
  // Se pondera de derecha a izquierda.
  const reversed = [...digits].reverse();
  const sum = reversed.reduce((acc, d, i) => acc + Number(d) * (DV_WEIGHTS[i] ?? 0), 0);
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
};

export const isValidNit = (nit: string, dv: string | number): boolean => {
  try {
    return nitCheckDigit(nit) === Number(dv);
  } catch {
    return false;
  }
};
