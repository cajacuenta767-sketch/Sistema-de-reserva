import { describe, expect, it } from 'vitest';
import {
  deriveDisplayName,
  nitCheckDigit,
  normalizeTaxId,
  requiresCheckDigit,
  invoiceabilityIssue,
  isInvoiceable,
  validateDocument,
} from '../../src/modules/crm/domain/Party.js';

/**
 * Documentos de identificación colombianos.
 *
 * Un NIT con dígito de verificación equivocado revienta la facturación
 * electrónica, y descubrirlo al emitir la primera factura es tarde: la DIAN la
 * rechaza y hay que corregir la ficha del cliente y volver a emitir.
 */

describe('dígito de verificación del NIT', () => {
  // NIT reales, con el dígito que la DIAN publica: son verificables sin creer
  // a la implementación. Un test que compara contra lo que el código ya hace no
  // comprueba nada.
  it.each([
    ['890903938', 8], // Bancolombia
    ['899999068', 1], // Ecopetrol
    ['890900608', 9], // Grupo Éxito
    ['900123456', 8],
  ])('NIT %s → DV %i', (nit, expected) => {
    expect(nitCheckDigit(nit)).toBe(expected);
  });

  it('cubre los dos ramas del residuo', () => {
    // Residuo 0 o 1 → el dígito ES el residuo; en el resto, 11 menos el residuo.
    expect(nitCheckDigit('899999068')).toBe(1); // residuo 1
    expect(nitCheckDigit('890903938')).toBe(8); // residuo 3 → 11 - 3
  });

  it('ignora puntos y guiones', () => {
    expect(nitCheckDigit('900.123.456')).toBe(nitCheckDigit('900123456'));
  });

  it('rechaza un NIT vacío o desmesurado', () => {
    expect(() => nitCheckDigit('')).toThrow(/inválido/);
    expect(() => nitCheckDigit('1'.repeat(20))).toThrow(/inválido/);
  });
});

describe('normalizeTaxId', () => {
  it('quita la puntuación con la que la gente escribe los NIT', () => {
    expect(normalizeTaxId('900.123.456-8')).toBe('9001234568');
    expect(normalizeTaxId('  830 006 973 ')).toBe('830006973');
  });

  it('una cadena vacía es ausencia de documento, no cadena vacía', () => {
    expect(normalizeTaxId('')).toBeNull();
    expect(normalizeTaxId('   ')).toBeNull();
    expect(normalizeTaxId(null)).toBeNull();
  });
});

describe('validateDocument', () => {
  it('solo el NIT lleva dígito de verificación', () => {
    expect(requiresCheckDigit('NIT')).toBe(true);
    expect(requiresCheckDigit('CC')).toBe(false);
    // Calcular un DV para una cédula es un error que llega hasta la factura.
    expect(validateDocument('CC', '1020304050').checkDigit).toBeUndefined();
  });

  it('lo calcula cuando no se aporta', () => {
    expect(validateDocument('NIT', '900123456')).toEqual({ valid: true, checkDigit: '8' });
  });

  it('rechaza un dígito de verificación que no corresponde', () => {
    const result = validateDocument('NIT', '900123456', '3');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('debería ser 8');
  });

  it('acepta el correcto', () => {
    expect(validateDocument('NIT', '900123456', '8').valid).toBe(true);
  });

  it('no rechaza una ficha sin documento: incompleta no es inválida', () => {
    // Un prospecto entra al CRM con un nombre y un teléfono. Exigirle el NIT
    // aquí obligaría a inventárselo, que es peor que no tenerlo. Quien sí lo
    // exige es `isInvoiceable`, al facturar.
    expect(validateDocument('CC', null).valid).toBe(true);
    expect(validateDocument('SIN_IDENTIFICAR', null).valid).toBe(true);
  });

  it('permite letras solo en pasaporte y PEP', () => {
    expect(validateDocument('PP', 'AB123456').valid).toBe(true);
    expect(validateDocument('CC', 'AB123456').valid).toBe(false);
  });
});

describe('isInvoiceable', () => {
  it('exige documento, salvo al consumidor final', () => {
    expect(isInvoiceable({ taxIdType: 'NIT', taxId: '900123456' })).toBe(true);
    expect(isInvoiceable({ taxIdType: 'NIT', taxId: null })).toBe(false);
    // La factura POS al consumidor final es legal sin identificar al comprador.
    expect(isInvoiceable({ taxIdType: 'SIN_IDENTIFICAR', taxId: null })).toBe(true);
  });

  it('el motivo nombra a la parte, que es lo que hay que ir a corregir', () => {
    const issue = invoiceabilityIssue({ taxIdType: 'NIT', taxId: null, displayName: 'Ferretería El Tornillo' });
    expect(issue).toContain('Ferretería El Tornillo');
    expect(invoiceabilityIssue({ taxIdType: 'NIT', taxId: '900123456', displayName: 'X' })).toBeNull();
  });
});

describe('deriveDisplayName', () => {
  it('usa el nombre comercial y, si falta, la razón social', () => {
    expect(deriveDisplayName({ kind: 'COMPANY', displayName: 'Andina', legalName: 'Andina SAS' })).toBe(
      'Andina',
    );
    expect(deriveDisplayName({ kind: 'COMPANY', displayName: '  ', legalName: 'Andina SAS' })).toBe(
      'Andina SAS',
    );
  });

  it('una parte sin ningún nombre no es una parte', () => {
    expect(() => deriveDisplayName({ kind: 'PERSON' })).toThrow(/al menos un nombre/);
  });
});
