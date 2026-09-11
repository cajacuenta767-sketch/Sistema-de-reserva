import { describe, expect, it } from 'vitest';
import { AppError, Money } from '@erp/core';
import {
  ancestorCodesOf,
  assertValidPucCode,
  closesAtYearEnd,
  defaultNatureFor,
  isDescendantOf,
  isValidPucCode,
  parentCodeOf,
  signedBalance,
  statementFor,
  typeForCode,
} from '../../src/modules/accounting/domain/Account.js';
import { COLOMBIAN_PUC, resolvePucAccount } from '../../src/modules/accounting/domain/Puc.js';
import { ACCOUNT_ROLES, REQUIRED_ROLES } from '../../src/modules/accounting/domain/AccountRoles.js';
import {
  assertBalanced,
  convertToBase,
  entryTotals,
  isBalanced,
  reverseLines,
  roundingTolerance,
  type EntryLineDraft,
} from '../../src/modules/accounting/domain/JournalEntry.js';
import {
  postCreditNote,
  postPaymentIn,
  postSalesInvoice,
} from '../../src/modules/accounting/domain/PostingEngine.js';
import {
  assertClosableInOrder,
  assertPeriodOpen,
  assertReopenableInOrder,
  fiscalYearRange,
  monthlyPeriods,
  periodContaining,
  requirePeriodFor,
  type PeriodLike,
} from '../../src/modules/accounting/domain/Periods.js';
import {
  buildTrialBalance,
  checkTrialBalance,
  incomeStatement,
  type LedgerRow,
} from '../../src/modules/accounting/domain/Reports.js';

const cop = (amount: string) => Money.of(amount, 'COP');

// ═══════════════════════════════════════════════════════════════════════════
describe('el código del PUC es la jerarquía', () => {
  it('deduce la clase del primer dígito', () => {
    expect(typeForCode('110505')).toBe('ASSET');
    expect(typeForCode('2365')).toBe('LIABILITY');
    expect(typeForCode('3605')).toBe('EQUITY');
    expect(typeForCode('413595')).toBe('INCOME');
    expect(typeForCode('510506')).toBe('EXPENSE');
    expect(typeForCode('613595')).toBe('COST');
    expect(typeForCode('710505')).toBe('COST');
    expect(typeForCode('810505')).toBe('MEMORANDUM');
  });

  it('encadena los ancestros por longitud de código', () => {
    expect(parentCodeOf('110505')).toBe('1105');
    expect(parentCodeOf('1105')).toBe('11');
    expect(parentCodeOf('11')).toBe('1');
    expect(parentCodeOf('1')).toBeNull();
    expect(ancestorCodesOf('110505')).toEqual(['1', '11', '1105']);
    expect(isDescendantOf('110505', '11')).toBe(true);
    expect(isDescendantOf('110505', '12')).toBe(false);
  });

  it('rechaza longitudes que el PUC no tiene', () => {
    expect(isValidPucCode('110505')).toBe(true);
    expect(isValidPucCode('110')).toBe(false);
    expect(isValidPucCode('11050')).toBe(false);
    expect(isValidPucCode('0105')).toBe(false);
    expect(isValidPucCode('11A5')).toBe(false);
    expect(() => assertValidPucCode('110')).toThrow(/3 dígitos/);
  });

  it('separa lo que va al balance de lo que va a resultados', () => {
    expect(statementFor('ASSET')).toBe('BALANCE');
    expect(statementFor('LIABILITY')).toBe('BALANCE');
    expect(statementFor('EQUITY')).toBe('BALANCE');
    expect(statementFor('INCOME')).toBe('RESULTS');
    expect(statementFor('EXPENSE')).toBe('RESULTS');
    expect(statementFor('COST')).toBe('RESULTS');
    expect(statementFor('MEMORANDUM')).toBe('MEMORANDUM');
    // Solo las de resultados se cierran contra patrimonio al terminar el año.
    expect(closesAtYearEnd('INCOME')).toBe(true);
    expect(closesAtYearEnd('ASSET')).toBe(false);
  });

  it('el saldo lleva el signo de la naturaleza, no del lado', () => {
    // Un banco con 500 al débito y un proveedor con 500 al crédito tienen los
    // dos saldo +500: "tener saldo" significa cosas distintas y el informe no
    // debe mostrar los pasivos en negativo.
    expect(signedBalance('DEBIT', '500', '0').toFixed(2)).toBe('500.00');
    expect(signedBalance('CREDIT', '0', '500').toFixed(2)).toBe('500.00');
    expect(signedBalance('CREDIT', '500', '0').toFixed(2)).toBe('-500.00');
  });
});

describe('el PUC sembrado es coherente', () => {
  it('todo código es válido y su padre existe', () => {
    const codes = new Set(COLOMBIAN_PUC.map((a) => a.code));
    for (const account of COLOMBIAN_PUC) {
      expect(() => assertValidPucCode(account.code)).not.toThrow();
      const parent = parentCodeOf(account.code);
      if (parent !== null) {
        expect(codes, `${account.code} (${account.name}) no tiene padre ${parent}`).toContain(parent);
      }
    }
  });

  it('no repite códigos', () => {
    const seen = new Set<string>();
    for (const account of COLOMBIAN_PUC) {
      expect(seen.has(account.code), `código duplicado: ${account.code}`).toBe(false);
      seen.add(account.code);
    }
  });

  it('ninguna cuenta con hijas recibe movimiento', () => {
    const parents = new Set(
      COLOMBIAN_PUC.map((a) => parentCodeOf(a.code)).filter((c): c is string => c !== null),
    );
    for (const account of COLOMBIAN_PUC) {
      if (parents.has(account.code)) {
        expect(account.postable ?? false, `${account.code} agrupa y además recibe movimiento`).toBe(
          false,
        );
      }
    }
  });

  it('las cuentas de valuación llevan la contraria a su clase, a propósito', () => {
    const depreciation = COLOMBIAN_PUC.find((a) => a.code === '159220');
    expect(resolvePucAccount(depreciation!).type).toBe('ASSET');
    expect(resolvePucAccount(depreciation!).nature).toBe('CREDIT');

    const returns = COLOMBIAN_PUC.find((a) => a.code === '417505');
    expect(resolvePucAccount(returns!).type).toBe('INCOME');
    expect(resolvePucAccount(returns!).nature).toBe('DEBIT');

    // Y las normales siguen a su clase.
    const clients = COLOMBIAN_PUC.find((a) => a.code === '130505');
    expect(resolvePucAccount(clients!).nature).toBe(defaultNatureFor('ASSET'));
  });

  it('cada rol contable apunta a una cuenta que existe y recibe movimiento', () => {
    for (const role of ACCOUNT_ROLES) {
      const account = COLOMBIAN_PUC.find((a) => a.code === role.defaultCode);
      expect(account, `el rol ${role.role} apunta a ${role.defaultCode}, que no está en el PUC`)
        .toBeDefined();
      expect(account?.postable, `${role.defaultCode} no recibe movimiento`).toBe(true);
    }
    expect(REQUIRED_ROLES.length).toBeGreaterThan(10);
  });

  it('las cuentas que exigen tercero son las auxiliares de terceros', () => {
    const withParty = COLOMBIAN_PUC.filter((a) => a.requiresParty).map((a) => a.code);
    expect(withParty).toContain('130505'); // clientes
    expect(withParty).toContain('220505'); // proveedores
    expect(withParty).toContain('280505'); // anticipos de clientes
    // El IVA generado no tiene tercero: se le debe a la DIAN, no a un cliente.
    expect(withParty).not.toContain('240805');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('el asiento cuadra o no existe', () => {
  const line = (side: 'DEBIT' | 'CREDIT', amount: string): EntryLineDraft => ({
    accountId: 'a',
    side,
    amount: cop(amount),
    description: 'x',
  });

  it('suma cada lado por separado', () => {
    const totals = entryTotals([line('DEBIT', '100'), line('CREDIT', '60'), line('CREDIT', '40')], 'COP');
    expect(totals.debit.toDb()).toBe('100.00');
    expect(totals.credit.toDb()).toBe('100.00');
    expect(totals.difference.isZero()).toBe(true);
  });

  it('detecta el descuadre y dice de cuánto', () => {
    const draft = {
      journalType: 'GENERAL' as const,
      date: '2026-03-15',
      memo: 'Prueba',
      sourceType: 'MANUAL',
      sourceId: null,
      currency: 'COP',
      exchangeRate: '1',
      lines: [line('DEBIT', '100'), line('CREDIT', '99.50')],
    };
    expect(isBalanced(draft.lines, 'COP')).toBe(false);
    expect(() => assertBalanced(draft)).toThrow(/no cuadra por 0,?\.?50|no cuadra por 0\.5000/);
  });

  it('un asiento de una sola línea no es un asiento', () => {
    expect(() =>
      assertBalanced({
        journalType: 'GENERAL',
        date: '2026-03-15',
        memo: 'Suelto',
        sourceType: 'MANUAL',
        sourceId: null,
        currency: 'COP',
        exchangeRate: '1',
        lines: [line('DEBIT', '100')],
      }),
    ).toThrow(/una sola línea/);
  });

  it('rechaza importes negativos: para mover al revés se cambia de lado', () => {
    expect(() =>
      assertBalanced({
        journalType: 'GENERAL',
        date: '2026-03-15',
        memo: 'Negativo',
        sourceType: 'MANUAL',
        sourceId: null,
        currency: 'COP',
        exchangeRate: '1',
        lines: [line('DEBIT', '-100'), line('CREDIT', '-100')],
      }),
    ).toThrow(/negativo/);
  });

  it('reversar cambia de lado, no de signo', () => {
    const reversed = reverseLines([line('DEBIT', '100'), line('CREDIT', '100')]);
    expect(reversed.map((l) => l.side)).toEqual(['CREDIT', 'DEBIT']);
    expect(reversed.every((l) => !l.amount.isNegative())).toBe(true);
    // Y el reverso del reverso es el original.
    expect(reverseLines(reversed).map((l) => l.side)).toEqual(['DEBIT', 'CREDIT']);
  });
});

describe('conversión a la moneda funcional', () => {
  it('en la misma moneda las dos columnas coinciden', () => {
    const { lines, rounding } = convertToBase(
      {
        journalType: 'SALES',
        date: '2026-03-15',
        memo: 'x',
        sourceType: 'MANUAL',
        sourceId: null,
        currency: 'COP',
        exchangeRate: '1',
        lines: [
          { accountId: 'a', side: 'DEBIT', amount: cop('1000'), description: 'd' },
          { accountId: 'b', side: 'CREDIT', amount: cop('1000'), description: 'c' },
        ],
      },
      'COP',
    );
    expect(lines[0]?.debit).toBe('1000.0000');
    expect(lines[0]?.baseDebit).toBe('1000.0000');
    expect(rounding.isZero()).toBe(true);
  });

  it('el residuo de centavos aparece y es medible', () => {
    // 3 × 33,3333 USD a 4.000,50 → cada línea redondeada no suma lo mismo que
    // el total convertido de una vez. Ese residuo es real y hay que verlo.
    const usd = (v: string) => Money.of(v, 'USD');
    const { rounding } = convertToBase(
      {
        journalType: 'SALES',
        date: '2026-03-15',
        memo: 'x',
        sourceType: 'MANUAL',
        sourceId: null,
        currency: 'USD',
        exchangeRate: '4000.505',
        lines: [
          { accountId: 'a', side: 'DEBIT', amount: usd('33.3333'), description: 'd' },
          { accountId: 'a', side: 'DEBIT', amount: usd('33.3333'), description: 'd' },
          { accountId: 'a', side: 'DEBIT', amount: usd('33.3334'), description: 'd' },
          { accountId: 'b', side: 'CREDIT', amount: usd('100'), description: 'c' },
        ],
      },
      'COP',
    );
    // Sea cual sea, el residuo tiene que caber en la tolerancia de un peso por
    // línea: más que eso no es redondeo, es un error de cálculo.
    expect(rounding.abs().lessThan(roundingTolerance(4, 'COP'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('motor de contabilización · oro fiscal colombiano', () => {
  it('una factura con IVA y tres retenciones, verificada a mano', () => {
    // Mercancías ............................ $1.200.000
    // Servicios ............................. $  675.000
    // Base gravable ......................... $1.875.000
    // IVA 19 % .............................. $  356.250
    // Total factura ......................... $2.231.250
    // ReteFuente 2,5 % sobre 1.875.000 ...... $   46.875
    // ReteIVA 15 % sobre 356.250 ............ $   53.437,50
    // ReteICA 9,66 x mil sobre 1.875.000 .... $   18.112,50
    // Retenciones ........................... $  118.425
    // Neto a transferir ..................... $2.112.825
    const entry = postSalesInvoice({
      number: 'FV-000123',
      date: '2026-03-15',
      partyId: 'p1',
      partyName: 'Distribuidora Andina S.A.S.',
      currency: 'COP',
      exchangeRate: '1',
      subtotal: cop('1875000'),
      goodsRevenue: cop('1200000'),
      servicesRevenue: cop('675000'),
      vat: cop('356250'),
      consumptionTax: cop('0'),
      withholdingIncome: cop('46875'),
      withholdingVat: cop('53437.50'),
      withholdingIca: cop('18112.50'),
      total: cop('2231250'),
    });

    const byRole = new Map(entry.lines.map((l) => [l.role, l]));
    expect(byRole.get('RECEIVABLES')?.amount.toDb()).toBe('2112825.00');
    expect(byRole.get('RECEIVABLES')?.side).toBe('DEBIT');
    expect(byRole.get('WITHHOLDING_INCOME_ASSET')?.amount.toDb()).toBe('46875.00');
    expect(byRole.get('WITHHOLDING_VAT_ASSET')?.amount.toDb()).toBe('53437.50');
    expect(byRole.get('WITHHOLDING_ICA_ASSET')?.amount.toDb()).toBe('18112.50');
    expect(byRole.get('SALES_GOODS')?.amount.toDb()).toBe('1200000.00');
    expect(byRole.get('SALES_SERVICES')?.amount.toDb()).toBe('675000.00');
    expect(byRole.get('VAT_OUTPUT')?.amount.toDb()).toBe('356250.00');

    // Las retenciones son un ACTIVO, no un menor ingreso: el ingreso
    // contabilizado tiene que ser la base gravable íntegra.
    const revenue = cop('1200000').plus(cop('675000'));
    expect(revenue.toDb()).toBe('1875000.00');

    const totals = entryTotals(entry.lines, 'COP');
    expect(totals.debit.toDb()).toBe('2231250.00');
    expect(totals.credit.toDb()).toBe('2231250.00');
  });

  it('sin retenciones no aparecen líneas en cero', () => {
    const entry = postSalesInvoice({
      number: 'FV-000124',
      date: '2026-03-15',
      partyId: 'p1',
      partyName: 'Tienda La Esquina',
      currency: 'COP',
      exchangeRate: '1',
      subtotal: cop('100000'),
      goodsRevenue: cop('100000'),
      servicesRevenue: cop('0'),
      vat: cop('19000'),
      consumptionTax: cop('0'),
      withholdingIncome: cop('0'),
      withholdingVat: cop('0'),
      withholdingIca: cop('0'),
      total: cop('119000'),
    });
    expect(entry.lines).toHaveLength(3);
    expect(entry.lines.map((l) => l.role)).toEqual(['RECEIVABLES', 'SALES_GOODS', 'VAT_OUTPUT']);
    expect(entry.lines[0]?.amount.toDb()).toBe('119000.00');
  });

  it('el impuesto al consumo va a su propia cuenta', () => {
    const entry = postSalesInvoice({
      number: 'FV-000125',
      date: '2026-03-15',
      partyId: 'p1',
      partyName: 'Restaurante El Fogón',
      currency: 'COP',
      exchangeRate: '1',
      subtotal: cop('50000'),
      goodsRevenue: cop('50000'),
      servicesRevenue: cop('0'),
      vat: cop('0'),
      consumptionTax: cop('4000'),
      withholdingIncome: cop('0'),
      withholdingVat: cop('0'),
      withholdingIca: cop('0'),
      total: cop('54000'),
    });
    const inc = entry.lines.find((l) => l.role === 'CONSUMPTION_TAX');
    expect(inc?.amount.toDb()).toBe('4000.00');
    expect(inc?.side).toBe('CREDIT');
  });

  it('el cobro con sobrante deja el exceso como deuda con el cliente', () => {
    const entry = postPaymentIn({
      number: 'RC-00045',
      date: '2026-04-01',
      partyId: 'p1',
      partyName: 'Distribuidora Andina S.A.S.',
      currency: 'COP',
      exchangeRate: '1',
      amount: cop('2500000'),
      applied: cop('2112825'),
      unapplied: cop('387175'),
      method: 'TRANSFER',
      invoiceNumbers: ['FV-000123'],
    });
    const byRole = new Map(entry.lines.map((l) => [l.role, l]));
    expect(byRole.get('BANK')?.side).toBe('DEBIT');
    expect(byRole.get('BANK')?.amount.toDb()).toBe('2500000.00');
    // El sobrante NO deja la cartera en negativo: es un pasivo.
    expect(byRole.get('CUSTOMER_ADVANCES')?.side).toBe('CREDIT');
    expect(byRole.get('CUSTOMER_ADVANCES')?.amount.toDb()).toBe('387175.00');
    expect(byRole.has('RECEIVABLES')).toBe(true);
  });

  it('el cobro en efectivo va a caja, no al banco', () => {
    const entry = postPaymentIn({
      number: 'RC-00046',
      date: '2026-04-01',
      partyId: 'p1',
      partyName: 'Tienda La Esquina',
      currency: 'COP',
      exchangeRate: '1',
      amount: cop('119000'),
      applied: cop('119000'),
      unapplied: cop('0'),
      method: 'CASH',
      invoiceNumbers: ['FV-000124'],
    });
    expect(entry.lines.map((l) => l.role)).toEqual(['CASH', 'RECEIVABLES']);
  });

  it('la nota de crédito no resta de ventas: usa la cuenta de devoluciones', () => {
    const entry = postCreditNote({
      number: 'NC-00007',
      invoiceNumber: 'FV-000124',
      date: '2026-04-10',
      partyId: 'p1',
      partyName: 'Tienda La Esquina',
      currency: 'COP',
      exchangeRate: '1',
      subtotal: cop('100000'),
      vat: cop('19000'),
      total: cop('119000'),
    });
    const roles = entry.lines.map((l) => l.role);
    expect(roles).toContain('SALES_RETURNS');
    expect(roles).not.toContain('SALES_GOODS');
    const totals = entryTotals(entry.lines, 'COP');
    expect(totals.debit.equals(totals.credit)).toBe(true);
  });

  it('un documento con totales incoherentes no llega a contabilizarse', () => {
    expect(() =>
      postSalesInvoice({
        number: 'FV-999',
        date: '2026-03-15',
        partyId: 'p1',
        partyName: 'X',
        currency: 'COP',
        exchangeRate: '1',
        subtotal: cop('100000'),
        goodsRevenue: cop('100000'),
        servicesRevenue: cop('0'),
        vat: cop('19000'),
        consumptionTax: cop('0'),
        withholdingIncome: cop('0'),
        withholdingVat: cop('0'),
        withholdingIca: cop('0'),
        // El total no es subtotal + IVA: el motor lo detecta en vez de guardar
        // un asiento descuadrado que alguien tendría que buscar meses después.
        total: cop('120000'),
      }),
    ).toThrow(AppError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('años fiscales y periodos', () => {
  it('genera doce meses más el periodo de ajustes', () => {
    const periods = monthlyPeriods(2026);
    expect(periods).toHaveLength(13);
    expect(periods[0]).toMatchObject({
      periodNo: 1,
      name: 'Enero 2026',
      startDate: '2026-01-01',
      endDate: '2026-01-31',
    });
    expect(periods[1]?.endDate).toBe('2026-02-28');
    expect(periods[11]).toMatchObject({ periodNo: 12, endDate: '2026-12-31' });
    expect(periods[12]).toMatchObject({ periodNo: 13, name: 'Ajustes 2026' });
    expect(fiscalYearRange(2026)).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' });
  });

  it('acierta con febrero de un año bisiesto', () => {
    expect(monthlyPeriods(2028)[1]?.endDate).toBe('2028-02-29');
  });

  const periodsOf = (statuses: Partial<Record<number, 'OPEN' | 'CLOSED'>> = {}): PeriodLike[] =>
    monthlyPeriods(2026).map((p) => ({
      id: `p${p.periodNo}`,
      periodNo: p.periodNo,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      status: statuses[p.periodNo] ?? 'OPEN',
    }));

  it('una fecha cae en su mes, y el 31 de diciembre en diciembre y no en ajustes', () => {
    const periods = periodsOf();
    expect(periodContaining(periods, '2026-03-15')?.name).toBe('Marzo 2026');
    expect(periodContaining(periods, '2026-12-31')?.periodNo).toBe(12);
    expect(periodContaining(periods, '2027-01-01')).toBeNull();
  });

  it('sin periodo abierto, el error dice qué hacer', () => {
    expect(() => requirePeriodFor(periodsOf(), '2027-01-05')).toThrow(/Abre el año fiscal/);
  });

  it('un periodo cerrado no recibe asientos', () => {
    const enero = periodsOf({ 1: 'CLOSED' })[0]!;
    expect(() => assertPeriodOpen(enero)).toThrow(AppError);
    try {
      assertPeriodOpen(enero);
    } catch (e) {
      expect(AppError.is(e) && e.code).toBe('PERIOD_CLOSED');
    }
  });

  it('los periodos se cierran en orden', () => {
    const periods = periodsOf({ 1: 'CLOSED' });
    const marzo = periods[2]!;
    expect(() => assertClosableInOrder(periods, marzo)).toThrow(/Febrero 2026 todavía abierto/);

    const conFebrero = periodsOf({ 1: 'CLOSED', 2: 'CLOSED' });
    expect(() => assertClosableInOrder(conFebrero, conFebrero[2]!)).not.toThrow();
  });

  it('y se reabren en orden inverso', () => {
    const periods = periodsOf({ 1: 'CLOSED', 2: 'CLOSED', 3: 'CLOSED' });
    expect(() => assertReopenableInOrder(periods, periods[0]!)).toThrow(/Marzo 2026/);
    expect(() => assertReopenableInOrder(periods, periods[2]!)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('informes', () => {
  const leaf = (
    code: string,
    name: string,
    type: LedgerRow['type'],
    nature: LedgerRow['nature'],
    debit: string,
    credit: string,
    opening = '0',
  ): LedgerRow => ({
    accountId: code,
    code,
    name,
    type,
    nature,
    openingBalance: opening,
    debit,
    credit,
  });

  /*
   * Los saldos que dejan seis asientos reales. No están inventados uno a uno:
   * se derivan de los asientos, que es la única forma de que un balance de
   * prueba de prueba cuadre por la razón correcta y no por casualidad.
   *
   *   A · Factura FV-000123   Clientes 2.231.250 a Ventas 1.875.000 e IVA 356.250
   *   B · Cobro RC-00045      Bancos 2.112.825 a Clientes 2.112.825
   *   C · Nota NC-00007       Devoluciones 75.000 e IVA 14.250 a Clientes 89.250
   *   D · Costo de la venta   Costo 900.000 a Inventario 900.000
   *   E · Nómina              Sueldos 400.000 a Caja 400.000
   *   F · Gastos varios       Otros gastos 25.000 a Caja 25.000
   */
  const movimientos: LedgerRow[] = [
    leaf('110505', 'Caja general', 'ASSET', 'DEBIT', '0', '425000', '500000'),
    leaf('111005', 'Bancos', 'ASSET', 'DEBIT', '2112825', '0'),
    leaf('130505', 'Clientes nacionales', 'ASSET', 'DEBIT', '2231250', '2202075'),
    leaf('143501', 'Mercancías para la venta', 'ASSET', 'DEBIT', '0', '900000', '3000000'),
    leaf('240805', 'IVA generado', 'LIABILITY', 'CREDIT', '14250', '356250'),
    leaf('413595', 'Venta de mercancías', 'INCOME', 'CREDIT', '0', '1875000'),
    leaf('417505', 'Devoluciones en ventas', 'INCOME', 'DEBIT', '75000', '0'),
    leaf('613595', 'Costo de mercancía vendida', 'COST', 'DEBIT', '900000', '0'),
    leaf('510506', 'Sueldos', 'EXPENSE', 'DEBIT', '400000', '0'),
    leaf('519595', 'Otros gastos', 'EXPENSE', 'DEBIT', '25000', '0'),
  ];

  it('las dos columnas del balance de prueba suman igual', () => {
    const check = checkTrialBalance(movimientos);
    expect(check.debit).toBe(check.credit);
    expect(check.balanced).toBe(true);
  });

  it('detecta un balance descuadrado en vez de presentarlo', () => {
    const roto = [...movimientos, leaf('519530', 'Aseo', 'EXPENSE', 'DEBIT', '1000', '0')];
    expect(checkTrialBalance(roto).balanced).toBe(false);
  });

  it('las cuentas de agrupación se calculan sumando sus hijas', () => {
    const tree = buildTrialBalance(movimientos);
    const activo = tree.find((n) => n.code === '1');
    expect(activo?.name).toBe('1');
    expect(activo?.isPostable).toBe(false);
    // Bancos 2.112.825 + Clientes 2.231.250; caja e inventario no se movieron
    // al débito en este mes.
    expect(activo?.debit).toBe('4344075.0000');

    const disponible = activo?.children.find((n) => n.code === '11');
    expect(disponible?.debit).toBe('2112825.0000');
    const caja = disponible?.children.find((n) => n.code === '1105');
    expect(caja?.children[0]?.code).toBe('110505');
    expect(caja?.children[0]?.isPostable).toBe(true);
  });

  it('el saldo de cierre es apertura más movimiento, con el signo de la cuenta', () => {
    const tree = buildTrialBalance([
      leaf('130505', 'Clientes', 'ASSET', 'DEBIT', '2231250', '2112825', '100000'),
      leaf('240805', 'IVA generado', 'LIABILITY', 'CREDIT', '0', '356250', '50000'),
    ]);
    const clientes = tree
      .find((n) => n.code === '1')
      ?.children[0]?.children[0]?.children[0];
    expect(clientes?.code).toBe('130505');
    expect(clientes?.closingBalance).toBe('218425.0000'); // 100.000 + 2.231.250 − 2.112.825

    const iva = tree.find((n) => n.code === '2')?.children[0]?.children[0]?.children[0];
    expect(iva?.code).toBe('240805');
    expect(iva?.closingBalance).toBe('406250.0000'); // 50.000 + 356.250, en positivo
  });

  it('el estado de resultados resta las devoluciones del ingreso', () => {
    const pyg = incomeStatement(movimientos);
    // Ingresos: 1.875.000 − 75.000 de devoluciones = 1.800.000
    expect(pyg.revenue).toBe('1800000.0000');
    expect(pyg.costs).toBe('900000.0000');
    expect(pyg.grossProfit).toBe('900000.0000');
    expect(pyg.expenses).toBe('425000.0000');
    expect(pyg.netResult).toBe('475000.0000');
  });

  it('ignora las cuentas de balance al calcular el resultado', () => {
    const soloBalance = movimientos.filter((r) => r.code.startsWith('1') || r.code.startsWith('2'));
    const pyg = incomeStatement(soloBalance);
    expect(pyg.revenue).toBe('0.0000');
    expect(pyg.netResult).toBe('0.0000');
  });
});
