import { describe, expect, it } from 'vitest';
import { aggregateDocumentTotals, computeLineTotals, type TaxDef } from '../src/tax/TaxLine.js';

const IVA19: TaxDef = { id: 'iva19', code: 'IVA19', kind: 'VAT', rate: 19, isWithholding: false };
const IVA5: TaxDef = { id: 'iva5', code: 'IVA5', kind: 'VAT', rate: 5, isWithholding: false };
const RETEFUENTE: TaxDef = {
  id: 'rf25',
  code: 'RTE-FTE-2.5',
  kind: 'WITHHOLDING_INCOME',
  rate: 2.5,
  isWithholding: true,
};
const RETEICA: TaxDef = {
  id: 'ica',
  code: 'RTE-ICA',
  kind: 'WITHHOLDING_ICA',
  rate: 0.966,
  isWithholding: true,
};

describe('computeLineTotals', () => {
  it('factura colombiana típica: 3 × $150.000 con IVA 19 % y ReteFuente 2,5 %', () => {
    const t = computeLineTotals({
      quantity: 3,
      unitPrice: 150_000,
      taxes: [IVA19, RETEFUENTE],
      currency: 'COP',
    });
    expect(t.gross.toDb()).toBe('450000.00');
    expect(t.subtotal.toDb()).toBe('450000.00');
    expect(t.taxTotal.toDb()).toBe('85500.00'); // 19 % de 450.000
    expect(t.withholdingTotal.toDb()).toBe('11250.00'); // 2,5 % de 450.000
    expect(t.total.toDb()).toBe('535500.00'); // la retención NO resta aquí
  });

  it('aplica primero el descuento porcentual y luego el fijo', () => {
    const t = computeLineTotals({
      quantity: 10,
      unitPrice: 1000,
      discountPercent: 10,
      discountAmount: 500,
      taxes: [IVA19],
      currency: 'COP',
    });
    expect(t.gross.toDb()).toBe('10000.00');
    expect(t.discount.toDb()).toBe('1500.00'); // 1.000 (10 %) + 500
    expect(t.subtotal.toDb()).toBe('8500.00');
    expect(t.taxTotal.toDb()).toBe('1615.00');
    expect(t.total.toDb()).toBe('10115.00');
  });

  it('no redondea en pasos intermedios: 7 × 1.428,57 con IVA 19 %', () => {
    const t = computeLineTotals({
      quantity: 7,
      unitPrice: '1428.57',
      taxes: [IVA19],
      currency: 'COP',
    });
    expect(t.subtotal.toDb()).toBe('9999.99');
    expect(t.taxTotal.toDb()).toBe('1900.00'); // 19 % de 9.999,99 = 1.899,9981 → 1.900,00
  });

  it('calcula un impuesto compuesto sobre la base más los impuestos previos', () => {
    const COMPOUND: TaxDef = {
      id: 'c',
      code: 'COMP',
      kind: 'OTHER',
      rate: 10,
      isWithholding: false,
      isCompound: true,
    };
    const t = computeLineTotals({ quantity: 1, unitPrice: 100, taxes: [IVA19, COMPOUND], currency: 'USD' });
    const compound = t.taxes.find((x) => x.taxId === 'c');
    expect(compound?.base.toDb()).toBe('119.00'); // 100 + 19 de IVA
    expect(compound?.amount.toDb()).toBe('11.90');
  });

  it('una línea sin impuestos deja los totales iguales al subtotal', () => {
    const t = computeLineTotals({ quantity: 2, unitPrice: '49.99', currency: 'USD' });
    expect(t.taxTotal.isZero()).toBe(true);
    expect(t.total.toDb()).toBe('99.98');
  });
});

describe('aggregateDocumentTotals', () => {
  it('agrupa impuestos por definición y resta las retenciones del neto a pagar', () => {
    const lines = [
      computeLineTotals({ quantity: 2, unitPrice: 100_000, taxes: [IVA19, RETEFUENTE], currency: 'COP' }),
      computeLineTotals({ quantity: 1, unitPrice: 50_000, taxes: [IVA19, RETEFUENTE], currency: 'COP' }),
      computeLineTotals({ quantity: 4, unitPrice: 25_000, taxes: [IVA5], currency: 'COP' }),
    ];
    const d = aggregateDocumentTotals(lines, 'COP');

    expect(d.subtotal.toDb()).toBe('350000.00'); // 200.000 + 50.000 + 100.000
    // IVA: 19 % de 250.000 = 47.500 · 5 % de 100.000 = 5.000
    expect(d.taxTotal.toDb()).toBe('52500.00');
    expect(d.withholdingTotal.toDb()).toBe('6250.00'); // 2,5 % de 250.000
    expect(d.total.toDb()).toBe('402500.00');
    expect(d.netPayable.toDb()).toBe('396250.00');

    const iva19 = d.taxesByDefinition.find((t) => t.taxId === 'iva19');
    expect(iva19?.base.toDb()).toBe('250000.00');
    expect(iva19?.amount.toDb()).toBe('47500.00');
    expect(d.taxesByDefinition).toHaveLength(3);
  });

  it('acumula varias retenciones distintas', () => {
    const lines = [
      computeLineTotals({
        quantity: 1,
        unitPrice: 1_000_000,
        taxes: [IVA19, RETEFUENTE, RETEICA],
        currency: 'COP',
      }),
    ];
    const d = aggregateDocumentTotals(lines, 'COP');
    expect(d.withholdingTotal.toDb()).toBe('34660.00'); // 25.000 + 9.660
    expect(d.netPayable.toDb()).toBe('1155340.00'); // 1.190.000 − 34.660
  });
});
