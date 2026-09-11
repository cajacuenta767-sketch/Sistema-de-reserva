import { describe, expect, it } from 'vitest';
import { Money } from '@erp/core';
import type { TaxDef } from '@erp/core';
import { computeDocumentTotals } from '../../src/modules/sales/domain/DocumentTotals.js';
import { computeWithholdings, totalWithheld } from '../../src/modules/sales/domain/Withholding.js';
import {
  AGING_LABEL,
  agingBucket,
  assertCanVoid,
  assertEditable,
  assertQuoteTransition,
  canTransitionQuote,
  daysOverdue,
  deriveInvoiceStatus,
  dueDateFrom,
} from '../../src/modules/sales/domain/Invoice.js';
import {
  allocateManually,
  allocateOldestFirst,
  outstandingOf,
  type OpenInvoice,
} from '../../src/modules/sales/domain/PaymentAllocation.js';

const IVA19: TaxDef = { id: 't1', code: 'IVA19', kind: 'VAT', rate: 19, isWithholding: false };
const IVA5: TaxDef = { id: 't2', code: 'IVA5', kind: 'VAT', rate: 5, isWithholding: false };
const INC8: TaxDef = { id: 't3', code: 'INC8', kind: 'INC', rate: 8, isWithholding: false };

const cop = (amount: string) => Money.of(amount, 'COP');

describe('totales de una factura colombiana', () => {
  it('el oro fiscal: una factura verificada a mano', () => {
    // 10 cajas a $120.000 = $1.200.000
    //  3 servicios a $250.000 = $750.000, con 10 % de descuento = $675.000
    // Base gravable ............................. $1.875.000
    // IVA 19 % sobre 1.200.000 .................. $  228.000
    // IVA 19 % sobre   675.000 .................. $  128.250
    // Total factura ............................. $2.231.250
    const result = computeDocumentTotals({
      currency: 'COP',
      lines: [
        { productId: 'p1', description: 'Caja de producto', quantity: '10', unitPrice: '120000', taxes: [IVA19] },
        {
          productId: 'p2',
          description: 'Servicio de instalación',
          quantity: '3',
          unitPrice: '250000',
          discountPercent: '10',
          taxes: [IVA19],
        },
      ],
    });

    expect(result.subtotal.toDb()).toBe('1875000.00');
    expect(result.taxTotal.toDb()).toBe('356250.00');
    expect(result.total.toDb()).toBe('2231250.00');
    expect(result.discountTotal.toDb()).toBe('75000.00');
  });

  it('el descuento global se reparte ANTES de los impuestos', () => {
    // Restarlo del total dejaría un IVA que no corresponde a su base, y la DIAN
    // rechaza esa factura.
    const result = computeDocumentTotals({
      currency: 'COP',
      globalDiscountPercent: '10',
      lines: [{ productId: 'p1', description: 'Algo', quantity: '1', unitPrice: '1000000', taxes: [IVA19] }],
    });

    expect(result.subtotal.toDb()).toBe('900000.00');
    expect(result.taxTotal.toDb()).toBe('171000.00'); // 19 % de 900.000, no de 1.000.000
    expect(result.total.toDb()).toBe('1071000.00');
  });

  it('los descuentos de línea y global se componen, no se suman', () => {
    // 10 % y 10 % dejan el 81 %, no el 80 %. Sumarlos da un total que no cuadra
    // con lo que el cliente calcula a mano, y eso acaba en una reclamación.
    const result = computeDocumentTotals({
      currency: 'COP',
      globalDiscountPercent: '10',
      lines: [{ productId: 'p1', description: 'Algo', quantity: '1', unitPrice: '1000000', discountPercent: '10' }],
    });
    expect(result.subtotal.toDb()).toBe('810000.00');
  });

  it('agrupa los impuestos por definición para la cabecera', () => {
    const result = computeDocumentTotals({
      currency: 'COP',
      lines: [
        { productId: 'a', description: 'Gravado 19', quantity: '1', unitPrice: '100000', taxes: [IVA19] },
        { productId: 'b', description: 'Gravado 19 otra vez', quantity: '2', unitPrice: '50000', taxes: [IVA19] },
        { productId: 'c', description: 'Gravado 5', quantity: '1', unitPrice: '200000', taxes: [IVA5] },
      ],
    });

    const byCode = Object.fromEntries(result.taxesByDefinition.map((t) => [t.code, t]));
    expect(byCode.IVA19?.base.toDb()).toBe('200000.00');
    expect(byCode.IVA19?.amount.toDb()).toBe('38000.00');
    expect(byCode.IVA5?.amount.toDb()).toBe('10000.00');
  });

  it('el IVA y el INC conviven en la misma factura', () => {
    const result = computeDocumentTotals({
      currency: 'COP',
      lines: [{ productId: 'p', description: 'Consumo en restaurante', quantity: '1', unitPrice: '100000', taxes: [INC8] }],
    });
    expect(result.taxTotal.toDb()).toBe('8000.00');
  });

  it('rechaza las líneas imposibles', () => {
    const base = { productId: 'p', description: 'X', quantity: '1', unitPrice: '1000' };
    expect(() => computeDocumentTotals({ currency: 'COP', lines: [] })).toThrow(/al menos una línea/);
    expect(() =>
      computeDocumentTotals({ currency: 'COP', lines: [{ ...base, description: '  ' }] }),
    ).toThrow(/descripción/);
    // Una cantidad negativa es una devolución encubierta sin rastro: para eso
    // están las notas de crédito.
    expect(() => computeDocumentTotals({ currency: 'COP', lines: [{ ...base, quantity: '-1' }] })).toThrow(
      /mayor que cero/,
    );
    expect(() => computeDocumentTotals({ currency: 'COP', lines: [{ ...base, unitPrice: '-5' }] })).toThrow(
      /no puede ser negativo/,
    );
    expect(() =>
      computeDocumentTotals({ currency: 'COP', lines: [{ ...base, discountPercent: '120' }] }),
    ).toThrow(/entre 0 y 100/);
    expect(() =>
      computeDocumentTotals({ currency: 'COP', globalDiscountPercent: '-1', lines: [base] }),
    ).toThrow(/entre 0 y 100/);
  });
});

describe('retenciones', () => {
  const RTF_COMPRAS = {
    id: 'w1',
    code: 'RTF-COMP',
    name: 'ReteFuente compras 2,5 %',
    kind: 'WITHHOLDING_INCOME' as const,
    rate: '2.5',
    minBase: '1377000', // 27 UVT
  };
  const RTIVA = {
    id: 'w2',
    code: 'RTIVA15',
    name: 'ReteIVA 15 %',
    kind: 'WITHHOLDING_VAT' as const,
    rate: '15',
    minBase: '204000',
  };

  it('se calculan sobre el DOCUMENTO, no línea a línea', () => {
    // Diez líneas de $200.000: ninguna llega a la base mínima de $1.377.000,
    // pero el documento suma $2.000.000 y sí la supera. Calculándolas por línea,
    // esta factura no retendría nada y se dejaría de practicar una retención
    // obligatoria.
    const lines = Array.from({ length: 10 }, (_, i) => ({
      productId: `p${i}`,
      description: `Línea ${i + 1}`,
      quantity: '1',
      unitPrice: '200000',
      taxes: [IVA19],
    }));

    const result = computeDocumentTotals({ currency: 'COP', lines, withholdings: [RTF_COMPRAS] });
    expect(result.subtotal.toDb()).toBe('2000000.00');
    expect(result.withholdingTotal.toDb()).toBe('50000.00'); // 2,5 % de 2.000.000
    expect(result.withholdings[0]?.skippedReason).toBeNull();
  });

  it('por debajo de la base mínima no se retiene, y explica por qué', () => {
    const result = computeDocumentTotals({
      currency: 'COP',
      lines: [{ productId: 'p', description: 'Compra pequeña', quantity: '1', unitPrice: '500000', taxes: [IVA19] }],
      withholdings: [RTF_COMPRAS],
    });

    expect(result.withholdingTotal.toDb()).toBe('0.00');
    expect(result.withholdings[0]?.skippedReason).toMatch(/no llega al mínimo/);
    // Y el total a pagar no cambia.
    expect(result.netPayable.toDb()).toBe(result.total.toDb());
  });

  it('el ReteIVA se calcula sobre el IVA, no sobre la base', () => {
    // 15 % sobre la base en vez de sobre el IVA retiene casi ocho veces de más.
    const result = computeDocumentTotals({
      currency: 'COP',
      lines: [{ productId: 'p', description: 'Servicio', quantity: '1', unitPrice: '2000000', taxes: [IVA19] }],
      withholdings: [RTIVA],
    });

    expect(result.taxTotal.toDb()).toBe('380000.00');
    expect(result.withholdings[0]?.base.toDb()).toBe('380000.00');
    expect(result.withholdingTotal.toDb()).toBe('57000.00'); // 15 % de 380.000
  });

  it('las retenciones NO se restan del total de la factura, sino del pago', () => {
    // La factura dice 2.380.000; el cliente transfiere 2.323.000 y certifica el
    // resto. Restarlas del total falsearía la base del IVA.
    const result = computeDocumentTotals({
      currency: 'COP',
      lines: [{ productId: 'p', description: 'Servicio', quantity: '1', unitPrice: '2000000', taxes: [IVA19] }],
      withholdings: [RTIVA],
    });

    expect(result.total.toDb()).toBe('2380000.00');
    expect(result.netPayable.toDb()).toBe('2323000.00');
  });

  it('sin base mínima se retiene siempre', () => {
    const honorarios = {
      id: 'w3',
      code: 'RTF-HON',
      name: 'ReteFuente honorarios 11 %',
      kind: 'WITHHOLDING_INCOME' as const,
      rate: '11',
      minBase: null,
    };
    const items = computeWithholdings({
      taxableBase: cop('100000'),
      vatTotal: cop('19000'),
      withholdings: [honorarios],
      currency: 'COP',
    });
    expect(items[0]?.amount.toDb()).toBe('11000.00');
    expect(totalWithheld(items, 'COP').toDb()).toBe('11000.00');
  });
});

describe('estado de una factura', () => {
  const base = { issued: true, voided: false, dueDate: '2026-04-10', today: '2026-03-10' };

  it('se deriva del saldo, no se guarda', () => {
    expect(deriveInvoiceStatus({ ...base, total: cop('1000'), paid: cop('0') })).toBe('ISSUED');
    expect(deriveInvoiceStatus({ ...base, total: cop('1000'), paid: cop('400') })).toBe('PARTIALLY_PAID');
    expect(deriveInvoiceStatus({ ...base, total: cop('1000'), paid: cop('1000') })).toBe('PAID');
    // Pagar de más (por un ajuste) sigue siendo pagada, no un estado nuevo.
    expect(deriveInvoiceStatus({ ...base, total: cop('1000'), paid: cop('1200') })).toBe('PAID');
  });

  it('vencida gana sobre parcialmente pagada', () => {
    // En la cartera lo que importa es que el plazo pasó, no que se abonó algo.
    expect(
      deriveInvoiceStatus({ ...base, dueDate: '2026-03-01', total: cop('1000'), paid: cop('400') }),
    ).toBe('OVERDUE');
  });

  it('borrador y anulada mandan sobre todo lo demás', () => {
    expect(deriveInvoiceStatus({ ...base, issued: false, total: cop('1000'), paid: cop('0') })).toBe('DRAFT');
    expect(deriveInvoiceStatus({ ...base, voided: true, total: cop('1000'), paid: cop('1000') })).toBe('VOID');
  });

  it('una factura emitida no se edita', () => {
    expect(() => assertEditable('DRAFT')).not.toThrow();
    expect(() => assertEditable('ISSUED')).toThrow(/nota de crédito/);
    expect(() => assertEditable('PAID')).toThrow(/sin cuadrar/);
  });

  it('una factura con pagos no se anula: se corrige con nota de crédito', () => {
    expect(() => assertCanVoid({ status: 'ISSUED', paid: cop('0') })).not.toThrow();
    expect(() => assertCanVoid({ status: 'DRAFT', paid: cop('0') })).not.toThrow();
    expect(() => assertCanVoid({ status: 'PARTIALLY_PAID', paid: cop('500') })).toThrow(/nota de crédito/);
    expect(() => assertCanVoid({ status: 'VOID', paid: cop('0') })).toThrow(/ya está anulada/);
  });
});

describe('cotizaciones', () => {
  it('permite el camino normal y el arrepentimiento', () => {
    expect(canTransitionQuote('DRAFT', 'SENT')).toBe(true);
    expect(canTransitionQuote('SENT', 'ACCEPTED')).toBe(true);
    expect(canTransitionQuote('ACCEPTED', 'CONVERTED')).toBe(true);
    // El cliente se echa atrás después de aceptar: pasa.
    expect(canTransitionQuote('ACCEPTED', 'REJECTED')).toBe(true);
    // Una rechazada se puede reabrir como borrador para renegociar.
    expect(canTransitionQuote('REJECTED', 'DRAFT')).toBe(true);
  });

  it('una cotización convertida es definitiva', () => {
    expect(canTransitionQuote('CONVERTED', 'DRAFT')).toBe(false);
    expect(() => assertQuoteTransition('CONVERTED', 'SENT')).toThrow(/crea una nueva/);
  });

  it('el mensaje del rechazo nombra los dos estados en castellano', () => {
    expect(() => assertQuoteTransition('DRAFT', 'CONVERTED')).toThrow(
      /en borrador no puede pasar a convertida/,
    );
  });
});

describe('vencimientos y cartera', () => {
  it('el vencimiento sale de la fecha de emisión, no de hoy', () => {
    // Refacturar en marzo un documento de enero da el vencimiento de enero.
    expect(dueDateFrom('2026-01-15', 30)).toBe('2026-02-14');
    expect(dueDateFrom('2026-03-10', 0)).toBe('2026-03-10');
  });

  it('cruza el cambio de mes y de año', () => {
    expect(dueDateFrom('2026-01-31', 30)).toBe('2026-03-02');
    expect(dueDateFrom('2026-12-20', 30)).toBe('2027-01-19');
    // 2028 es bisiesto: febrero tiene 29.
    expect(dueDateFrom('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('cuenta los días de mora', () => {
    expect(daysOverdue('2026-03-01', '2026-03-10')).toBe(9);
    expect(daysOverdue('2026-03-10', '2026-03-10')).toBe(0);
    expect(daysOverdue('2026-04-10', '2026-03-10')).toBe(-31);
  });

  it('clasifica por tramos de 30 días', () => {
    expect(agingBucket('2026-04-10', '2026-03-10')).toBe('CURRENT');
    expect(agingBucket('2026-03-09', '2026-03-10')).toBe('D1_30');
    // 30 días justos siguen siendo el primer tramo; 31 ya es el segundo.
    expect(agingBucket('2026-02-08', '2026-03-10')).toBe('D1_30');
    expect(agingBucket('2026-02-07', '2026-03-10')).toBe('D31_60');
    expect(agingBucket('2026-01-08', '2026-03-10')).toBe('D61_90');
    expect(agingBucket('2025-10-01', '2026-03-10')).toBe('D90_PLUS');
    expect(AGING_LABEL.D90_PLUS).toBe('Más de 90 días');
  });
});

describe('imputación de pagos', () => {
  const invoice = (over: Partial<OpenInvoice> & { id: string; number: string; dueDate: string }): OpenInvoice => ({
    issueDate: '2026-01-01',
    total: cop('100000'),
    paid: cop('0'),
    ...over,
  });

  const abiertas = [
    invoice({ id: 'i3', number: 'FV-3', dueDate: '2026-03-01', total: cop('300000') }),
    invoice({ id: 'i1', number: 'FV-1', dueDate: '2026-01-15', total: cop('100000') }),
    invoice({ id: 'i2', number: 'FV-2', dueDate: '2026-02-01', total: cop('200000'), paid: cop('50000') }),
  ];

  it('paga de la más antigua a la más reciente', () => {
    // FV-1 debe 100.000, FV-2 debe 150.000 (ya tenía 50.000 abonados) y FV-3
    // debe 300.000: el pago cubre las dos primeras y abona 30.000 a la tercera.
    const result = allocateOldestFirst(cop('280000'), abiertas);
    expect(result.lines.map((l) => l.number)).toEqual(['FV-1', 'FV-2', 'FV-3']);
    expect(result.lines[0]?.amount.toDb()).toBe('100000.00');
    expect(result.lines[0]?.remainingAfter.toDb()).toBe('0.00');
    expect(result.lines[1]?.amount.toDb()).toBe('150000.00');
    expect(result.lines[2]?.amount.toDb()).toBe('30000.00');
    expect(result.lines[2]?.remainingAfter.toDb()).toBe('270000.00');
    expect(result.applied.toDb()).toBe('280000.00');
    expect(result.unapplied.toDb()).toBe('0.00');
  });

  it('el sobrante queda como saldo a favor, no se fuerza sobre la última', () => {
    // Forzarlo dejaría una factura pagada de más: un estado que la contabilidad
    // no sabe representar y que aparece como descuadre al cerrar el mes.
    const result = allocateOldestFirst(cop('1000000'), abiertas);
    expect(result.applied.toDb()).toBe('550000.00');
    expect(result.unapplied.toDb()).toBe('450000.00');
    for (const line of result.lines) expect(line.remainingAfter.toDb()).toBe('0.00');
  });

  it('un abono parcial deja saldo en la primera factura', () => {
    const result = allocateOldestFirst(cop('40000'), abiertas);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.number).toBe('FV-1');
    expect(result.lines[0]?.remainingAfter.toDb()).toBe('60000.00');
    expect(result.unapplied.toDb()).toBe('0.00');
  });

  it('ignora las facturas ya saldadas', () => {
    const saldada = invoice({ id: 'i9', number: 'FV-9', dueDate: '2025-01-01', paid: cop('100000') });
    const result = allocateOldestFirst(cop('50000'), [saldada, ...abiertas]);
    expect(result.lines[0]?.number).toBe('FV-1');
    expect(outstandingOf(saldada).toDb()).toBe('0.00');
  });

  it('rechaza un pago de cero o negativo', () => {
    expect(() => allocateOldestFirst(cop('0'), abiertas)).toThrow(/mayor que cero/);
    expect(() => allocateOldestFirst(cop('-100'), abiertas)).toThrow(/mayor que cero/);
  });

  it('la imputación manual respeta lo indicado', () => {
    const result = allocateManually(
      cop('250000'),
      [
        { invoiceId: 'i3', amount: '200000' },
        { invoiceId: 'i1', amount: '50000' },
      ],
      abiertas,
    );
    expect(result.lines.map((l) => l.number)).toEqual(['FV-3', 'FV-1']);
    expect(result.lines[0]?.remainingAfter.toDb()).toBe('100000.00');
    expect(result.unapplied.toDb()).toBe('0.00');
  });

  it('no deja imputar más de lo que la factura debe', () => {
    // Ese saldo negativo no se ve hasta que alguien cuadra la cartera meses después.
    expect(() =>
      allocateManually(cop('500000'), [{ invoiceId: 'i1', amount: '150000' }], abiertas),
    ).toThrow(/quedaría pagada de más/);
  });

  it('no deja repartir más de lo recibido', () => {
    expect(() =>
      allocateManually(
        cop('100000'),
        [
          { invoiceId: 'i1', amount: '100000' },
          { invoiceId: 'i3', amount: '100000' },
        ],
        abiertas,
      ),
    ).toThrow(/más de lo recibido/);
  });

  it('rechaza una factura que no es de este cliente', () => {
    expect(() =>
      allocateManually(cop('100000'), [{ invoiceId: 'ajena', amount: '1000' }], abiertas),
    ).toThrow(/no está entre las abiertas/);
  });
});
