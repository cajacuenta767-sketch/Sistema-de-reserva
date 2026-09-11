import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  makeTestApp,
  registerOrganization,
  type Account,
  type TestApp,
} from '../helpers.js';

let t: TestApp;
let owner: Account;
let cliente: string;
let producto: string;
let servicio: string;

beforeAll(async () => {
  t = await makeTestApp();
  owner = await registerOrganization(t, { organizationName: 'Contable S.A.S.' });

  const party = await owner
    .as('post', '/api/v1/parties')
    .send({ displayName: 'Supermercados La 14', taxId: '890903938' })
    .expect(201);
  cliente = party.body.id;

  const p1 = await owner
    .as('post', '/api/v1/products')
    .send({ name: 'Caja de producto', sku: 'CAJA-01', salePrice: '120000' })
    .expect(201);
  producto = p1.body.id;

  const p2 = await owner
    .as('post', '/api/v1/products')
    .send({ name: 'Servicio de instalación', kind: 'SERVICE', sku: 'SERV-01', salePrice: '250000' })
    .expect(201);
  servicio = p2.body.id;
});

afterAll(async () => {
  await t.close();
});

/** Suma de control global: la contabilidad entera cuadra, no solo cada asiento. */
const globalBalance = async (): Promise<{ debit: string; credit: string }> =>
  asTenant(t, owner, async (client) => {
    const { rows } = await client.query<{ debit: string; credit: string }>(
      `SELECT coalesce(sum(base_debit), 0)::text AS debit,
              coalesce(sum(base_credit), 0)::text AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED'`,
    );
    return rows[0] ?? { debit: '0', credit: '0' };
  });

const emitir = async (over: Record<string, unknown> = {}): Promise<Record<string, string>> => {
  const draft = await owner
    .as('post', '/api/v1/invoices')
    .send({
      partyId: cliente,
      paymentTermsDays: 30,
      lines: [
        { productId: producto, quantity: '10' },
        { productId: servicio, quantity: '3', discountPercent: '10' },
      ],
      ...over,
    })
    .expect(201);
  const issued = await owner
    .as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`)
    .expect(200);
  return issued.body.invoice;
};

// ═══════════════════════════════════════════════════════════════════════════
describe('la empresa nace con su contabilidad puesta', () => {
  it('siembra el PUC colombiano con la jerarquía completa', async () => {
    const rows = await asTenant(t, owner, async (client) => {
      const result = await client.query<{ code: string; parent_code: string | null }>(
        `SELECT a.code, p.code AS parent_code
           FROM accounts a LEFT JOIN accounts p ON p.id = a.parent_id
          ORDER BY a.code`,
      );
      return result.rows;
    });

    expect(rows.length).toBeGreaterThan(150);
    const codes = new Set(rows.map((r) => r.code));
    expect(codes).toContain('130505'); // clientes
    expect(codes).toContain('240805'); // IVA generado
    expect(codes).toContain('413595'); // ventas

    // Toda cuenta que no sea de clase cuelga de su padre por código.
    for (const row of rows) {
      if (row.code.length === 1) expect(row.parent_code).toBeNull();
      else expect(row.code.startsWith(row.parent_code ?? '·')).toBe(true);
    }
  });

  it('resuelve las cuentas por operación', async () => {
    const { body } = await owner.as('get', '/api/v1/accounting/account-roles').expect(200);
    const required = body.filter((r: { required: boolean }) => r.required);
    // Ninguna cuenta obligatoria puede quedar sin resolver: la primera factura
    // fallaría al contabilizarse, y el usuario no sabría por qué.
    expect(required.every((r: { accountId: string | null }) => r.accountId !== null)).toBe(true);

    const receivable = body.find((r: { role: string }) => r.role === 'RECEIVABLES');
    expect(receivable.accountCode).toBe('130505');
  });

  it('crea los ocho diarios con su consecutivo propio', async () => {
    const { body } = await owner.as('get', '/api/v1/accounting/journals').expect(200);
    expect(body.map((j: { code: string }) => j.code).sort()).toEqual([
      'AP',
      'CI',
      'CJ',
      'CP',
      'GN',
      'IN',
      'NM',
      'VT',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('emitir una factura genera su asiento', () => {
  let factura: Record<string, string>;
  let asiento: {
    entry: Record<string, string>;
    lines: Array<Record<string, string>>;
    source: { url: string; label: string } | null;
  };

  it('el asiento nace con la factura, en la misma transacción', async () => {
    factura = await emitir();

    const { body } = await owner
      .as('get', `/api/v1/accounting/entries/by-source/sales_invoice/${factura.id}`)
      .expect(200);
    asiento = body;

    expect(asiento.entry.status).toBe('POSTED');
    expect(asiento.entry.number).toMatch(/^VT-\d{6}$/);
    expect(asiento.entry.journalCode).toBe('VT');
    expect(asiento.entry.memo).toContain(factura.number);
  });

  it('cuadra, y sus totales coinciden con la factura', () => {
    expect(asiento.entry.debitTotal).toBe(asiento.entry.creditTotal);
    // Factura: 1.200.000 mercancías + 675.000 servicios = 1.875.000
    //          IVA 19 % = 356.250 → total 2.231.250
    expect(asiento.entry.debitTotal).toBe('2231250.0000');
    expect(factura.total).toBe('2231250.0000');
  });

  it('lleva cada cifra a su cuenta del PUC', () => {
    const byCode = new Map(asiento.lines.map((l) => [l.accountCode, l]));

    expect(byCode.get('130505')?.debit).toBe('2231250.0000'); // clientes
    expect(byCode.get('413595')?.credit).toBe('1200000.0000'); // venta de mercancías
    expect(byCode.get('417005')?.credit).toBe('675000.0000'); // servicios prestados
    expect(byCode.get('240805')?.credit).toBe('356250.0000'); // IVA generado

    // El ingreso está separado por naturaleza: sin eso, una empresa de
    // servicios declararía todo como venta de mercancías.
    expect(byCode.has('413595') && byCode.has('417005')).toBe(true);
  });

  it('la línea de cartera lleva el tercero, o no habría auxiliar que cobrar', () => {
    const cartera = asiento.lines.find((l) => l.accountCode === '130505');
    expect(cartera?.partyId).toBe(cliente);
    expect(cartera?.partyName).toBe('Supermercados La 14');
  });

  it('el drill-down llega hasta la factura', () => {
    expect(asiento.source?.label).toBe('Factura de venta');
    expect(asiento.source?.url).toBe(`/facturas/${factura.id}`);
  });

  it('y la contabilidad entera cuadra', async () => {
    const totals = await globalBalance();
    expect(totals.debit).toBe(totals.credit);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('cobrar también contabiliza', () => {
  it('el cobro con sobrante deja el exceso como deuda con el cliente', async () => {
    // Cliente propio: con cartera anterior, la imputación automática consumiría
    // el dinero en las facturas viejas y no habría sobrante que comprobar.
    const nuevo = await owner
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Ferretería El Tornillo' })
      .expect(201);

    const draft = await owner
      .as('post', '/api/v1/invoices')
      .send({ partyId: nuevo.body.id, lines: [{ productId: producto, quantity: '1' }] })
      .expect(201);
    const emitida = await owner
      .as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`)
      .expect(200);
    // 120.000 + 19 % = 142.800. Se cobran 200.000: sobran 57.200.
    expect(emitida.body.invoice.total).toBe('142800.0000');

    const pago = await owner
      .as('post', '/api/v1/payments')
      .send({ partyId: nuevo.body.id, amount: '200000', method: 'TRANSFER' })
      .expect(201);

    const { body } = await owner
      .as('get', `/api/v1/accounting/entries/by-source/payment/${pago.body.payment.id}`)
      .expect(200);

    const byCode = new Map(
      (body.lines as Array<Record<string, string>>).map((l) => [l.accountCode, l]),
    );
    expect(byCode.get('111005')?.debit).toBe('200000.0000'); // bancos
    expect(byCode.get('130505')?.credit).toBe('142800.0000'); // cartera saldada
    // El sobrante NO deja la cartera en negativo: es un pasivo con el cliente.
    expect(byCode.get('280505')?.credit).toBe('57200.0000');
    expect(body.entry.journalCode).toBe('CJ');

    const totals = await globalBalance();
    expect(totals.debit).toBe(totals.credit);
  });

  it('anular el cobro genera la reversión, no borra el asiento', async () => {
    const factura = await emitir({ lines: [{ productId: producto, quantity: '2' }] });
    void factura;
    const pago = await owner
      .as('post', '/api/v1/payments')
      .send({ partyId: cliente, amount: '50000', method: 'CASH' })
      .expect(201);

    const antes = await owner
      .as('get', `/api/v1/accounting/entries/by-source/payment/${pago.body.payment.id}`)
      .expect(200);

    await owner
      .as('post', `/api/v1/payments/${pago.body.payment.id}/void`)
      .send({ reason: 'Cheque devuelto' })
      .expect(200);

    const despues = await owner
      .as('get', `/api/v1/accounting/entries/${antes.body.entry.id}`)
      .expect(200);

    // El original sigue ahí, con su número, y ahora apunta a su reversión.
    expect(despues.body.entry.number).toBe(antes.body.entry.number);
    expect(despues.body.reversal).not.toBeNull();

    const reversion = await owner
      .as('get', `/api/v1/accounting/entries/${despues.body.reversal.id}`)
      .expect(200);
    // Los lados están cambiados, no los signos.
    const originalCaja = (antes.body.lines as Array<Record<string, string>>).find(
      (l) => l.accountCode === '110505',
    );
    const reversaCaja = (reversion.body.lines as Array<Record<string, string>>).find(
      (l) => l.accountCode === '110505',
    );
    expect(originalCaja?.debit).toBe(reversaCaja?.credit);
    expect(reversaCaja?.debit).toBe('0.0000');

    const totals = await globalBalance();
    expect(totals.debit).toBe(totals.credit);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('el cierre de periodo', () => {
  let periodos: Array<{ id: string; name: string; periodNo: number; status: string }>;
  let yearId: string;

  it('el año se abrió solo al contabilizar la primera factura', async () => {
    const { body } = await owner.as('get', '/api/v1/accounting/fiscal-years').expect(200);
    expect(body).toHaveLength(1);
    yearId = body[0].year.id;
    periodos = body[0].periods;
    expect(body[0].year.name).toBe('2026');
    // Doce meses más el periodo de ajustes.
    expect(periodos).toHaveLength(13);
  });

  it('los periodos se cierran en orden, no salteados', async () => {
    const marzo = periodos.find((p) => p.periodNo === 3)!;
    const respuesta = await owner
      .as('post', `/api/v1/accounting/periods/${marzo.id}/close`)
      .expect(422);
    expect(respuesta.body.error.message).toMatch(/Enero 2026 todavía abierto/);
  });

  it('cerrar enero bloquea contabilizar en enero', async () => {
    const enero = periodos.find((p) => p.periodNo === 1)!;
    const cerrado = await owner
      .as('post', `/api/v1/accounting/periods/${enero.id}/close`)
      .expect(200);
    expect(cerrado.body.status).toBe('CLOSED');

    // Una factura con fecha de enero ya no se puede emitir: su asiento caería
    // en un periodo cerrado, y como la contabilización es transaccional, la
    // factura tampoco se emite.
    const draft = await owner
      .as('post', '/api/v1/invoices')
      .send({
        partyId: cliente,
        issueDate: '2026-01-15',
        lines: [{ productId: producto, quantity: '1' }],
      })
      .expect(201);

    const fallo = await owner
      .as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`)
      .expect(422);
    expect(fallo.body.error.code).toBe('PERIOD_CLOSED');
    expect(fallo.body.error.message).toMatch(/Enero 2026/);

    // Y la factura sigue siendo un borrador: la transacción entera se revirtió.
    const sigue = await owner
      .as('get', `/api/v1/invoices/${draft.body.invoice.id}`)
      .expect(200);
    expect(sigue.body.invoice.status).toBe('DRAFT');
    expect(sigue.body.invoice.number).toBeNull();
  });

  it('marzo sigue abierto y admite facturas', async () => {
    const factura = await emitir({ lines: [{ productId: producto, quantity: '1' }] });
    expect(factura.number).toBeTruthy();
  });

  it('no se reabre saltándose los posteriores', async () => {
    const febrero = periodos.find((p) => p.periodNo === 2)!;
    await owner.as('post', `/api/v1/accounting/periods/${febrero.id}/close`).expect(200);

    const enero = periodos.find((p) => p.periodNo === 1)!;
    const respuesta = await owner
      .as('post', `/api/v1/accounting/periods/${enero.id}/reopen`)
      .expect(422);
    expect(respuesta.body.error.message).toMatch(/Febrero 2026/);
  });

  it('reabrir en orden inverso sí funciona, y vuelve a admitir asientos', async () => {
    const febrero = periodos.find((p) => p.periodNo === 2)!;
    const enero = periodos.find((p) => p.periodNo === 1)!;
    await owner.as('post', `/api/v1/accounting/periods/${febrero.id}/reopen`).expect(200);
    await owner.as('post', `/api/v1/accounting/periods/${enero.id}/reopen`).expect(200);

    const draft = await owner
      .as('post', '/api/v1/invoices')
      .send({
        partyId: cliente,
        issueDate: '2026-01-20',
        lines: [{ productId: producto, quantity: '1' }],
      })
      .expect(201);
    await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200);
  });

  it('el año no se cierra con periodos abiertos', async () => {
    const respuesta = await owner
      .as('post', `/api/v1/accounting/fiscal-years/${yearId}/close`)
      .expect(422);
    expect(respuesta.body.error.message).toMatch(/periodo\(s\) sin cerrar/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('informes', () => {
  it('el balance de prueba cuadra y arma el árbol del PUC', async () => {
    const { body } = await owner
      .as('get', '/api/v1/accounting/reports/trial-balance?from=2026-01-01&to=2026-12-31')
      .expect(200);

    expect(body.totals.balanced).toBe(true);
    expect(body.totals.debit).toBe(body.totals.credit);

    const activo = body.rows.find((r: { code: string }) => r.code === '1');
    expect(activo).toBeDefined();
    // Las cuentas de agrupación se calculan sumando sus hijas, no se consultan.
    expect(activo.isPostable).toBe(false);
    expect(Number(activo.debit)).toBeGreaterThan(0);
  });

  it('el estado de resultados separa ingresos, costos y gastos', async () => {
    const { body } = await owner
      .as('get', '/api/v1/accounting/reports/income-statement?from=2026-01-01&to=2026-12-31')
      .expect(200);
    expect(Number(body.revenue)).toBeGreaterThan(0);
    // El resultado es ingresos − costos − gastos, y se comprueba como tal: sin
    // esto el informe podría devolver cualquier cifra coherente consigo misma.
    expect(Number(body.netResult)).toBeCloseTo(
      Number(body.revenue) - Number(body.costs) - Number(body.expenses),
      4,
    );
    // Todo lo facturado es ingreso; todavía no hay compras ni nómina.
    expect(Number(body.costs)).toBe(0);
  });

  it('el balance general cumple la ecuación contable', async () => {
    const { body } = await owner
      .as('get', '/api/v1/accounting/reports/balance-sheet?to=2026-12-31')
      .expect(200);
    // Activo = pasivo + patrimonio + resultado del periodo. El resultado va
    // aparte porque hasta cerrar el año no vive en ninguna cuenta de patrimonio.
    expect(body.totals.balanced).toBe(true);
    expect(body.totals.difference).toBe('0.0000');
  });

  it('el libro mayor de clientes lleva saldo corrido y enlaza al documento', async () => {
    const cuentas = await owner
      .as('get', '/api/v1/accounting/accounts?filter[code]=130505')
      .expect(200);
    const cuenta = cuentas.body.items[0];

    const { body } = await owner
      .as('get', `/api/v1/accounting/reports/ledger?accountId=${cuenta.id}&from=2026-01-01&to=2026-12-31`)
      .expect(200);

    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows[0].sourceType).toBe('sales_invoice');
    expect(body.rows[0].sourceId).toBeTruthy();
    // El saldo corrido va sumando: el último es el saldo de cierre.
    expect(body.rows[body.rows.length - 1].runningBalance).toBe(body.closing);
  });

  it('el auxiliar por tercero cuadra con la cartera del módulo de ventas', async () => {
    const cuentas = await owner
      .as('get', '/api/v1/accounting/accounts?filter[code]=130505')
      .expect(200);

    const auxiliar = await owner
      .as('get', `/api/v1/accounting/reports/party-subledger?accountId=${cuentas.body.items[0].id}`)
      .expect(200);

    const cartera = await owner.as('get', '/api/v1/invoices/aging').expect(200);
    const pendienteVentas = (cartera.body.items as Array<{ total: string }>).reduce(
      (acc, r) => acc + Number(r.total),
      0,
    );

    // Que las dos cifras coincidan es la comprobación que descubre los errores
    // de verdad: si no cuadran, algún documento no se contabilizó.
    expect(Number(auxiliar.body.total)).toBeCloseTo(pendienteVentas, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('asientos manuales', () => {
  let cuentaCaja: string;
  let cuentaGasto: string;

  beforeAll(async () => {
    const caja = await owner.as('get', '/api/v1/accounting/accounts?filter[code]=110505').expect(200);
    cuentaCaja = caja.body.items[0].id;
    const gasto = await owner.as('get', '/api/v1/accounting/accounts?filter[code]=519595').expect(200);
    cuentaGasto = gasto.body.items[0].id;
  });

  it('un asiento cuadrado se contabiliza', async () => {
    const { body } = await owner
      .as('post', '/api/v1/accounting/entries')
      .send({
        date: '2026-03-10',
        memo: 'Compra de papelería en efectivo',
        lines: [
          { accountId: cuentaGasto, debit: '50000' },
          { accountId: cuentaCaja, credit: '50000' },
        ],
      })
      .expect(201);

    expect(body.entry.status).toBe('POSTED');
    expect(body.entry.number).toMatch(/^GN-/);
    expect(body.entry.debitTotal).toBe('50000.0000');
  });

  it('uno descuadrado se rechaza, con el importe de la diferencia', async () => {
    const { body } = await owner
      .as('post', '/api/v1/accounting/entries')
      .send({
        date: '2026-03-10',
        memo: 'Descuadrado',
        lines: [
          { accountId: cuentaGasto, debit: '50000' },
          { accountId: cuentaCaja, credit: '49000' },
        ],
      })
      .expect(422);
    expect(body.error.message).toMatch(/no cuadra por 1000/);
  });

  it('una línea con los dos lados se rechaza antes de llegar a la base', async () => {
    const { body } = await owner
      .as('post', '/api/v1/accounting/entries')
      .send({
        date: '2026-03-10',
        memo: 'Dos lados',
        lines: [
          { accountId: cuentaGasto, debit: '50000', credit: '10000' },
          { accountId: cuentaCaja, credit: '40000' },
        ],
      })
      .expect(400);
    expect(body.error.message).toMatch(/débito y al crédito a la vez/);
  });

  it('no se contabiliza en una cuenta de agrupación', async () => {
    const grupo = await owner.as('get', '/api/v1/accounting/accounts?filter[code]=1105').expect(200);
    const { body } = await owner
      .as('post', '/api/v1/accounting/entries')
      .send({
        date: '2026-03-10',
        memo: 'En una cuenta madre',
        lines: [
          { accountId: grupo.body.items[0].id, debit: '1000' },
          { accountId: cuentaCaja, credit: '1000' },
        ],
      })
      .expect(422);
    expect(body.error.message).toMatch(/agrupación/);
  });

  it('un asiento contabilizado no se puede editar ni borrar por ninguna vía', async () => {
    const creado = await owner
      .as('post', '/api/v1/accounting/entries')
      .send({
        date: '2026-03-10',
        memo: 'Intocable',
        lines: [
          { accountId: cuentaGasto, debit: '7000' },
          { accountId: cuentaCaja, credit: '7000' },
        ],
      })
      .expect(201);

    // Ni siquiera con SQL directo, que es lo que hace que la garantía sirva
    // cuando el día de mañana otro módulo escriba asientos.
    await expect(
      asTenant(t, owner, (client) =>
        client.query('UPDATE journal_entries SET memo = $2 WHERE id = $1', [
          creado.body.entry.id,
          'modificado',
        ]),
      ),
    ).rejects.toThrow(/contabilizado y no se modifica/);

    await expect(
      asTenant(t, owner, (client) =>
        client.query('DELETE FROM journal_entries WHERE id = $1', [creado.body.entry.id]),
      ),
    ).rejects.toThrow(/contabilizado y no se borra/);
  });

  it('se corrige con una reversión, fechada hoy y no en el periodo original', async () => {
    const creado = await owner
      .as('post', '/api/v1/accounting/entries')
      .send({
        date: '2026-02-10',
        memo: 'Con error',
        lines: [
          { accountId: cuentaGasto, debit: '3000' },
          { accountId: cuentaCaja, credit: '3000' },
        ],
      })
      .expect(201);

    const { body } = await owner
      .as('post', `/api/v1/accounting/entries/${creado.body.entry.id}/reverse`)
      .send({ reason: 'Cuenta equivocada' })
      .expect(200);

    // El reloj de los tests está en marzo: la reversión es de marzo.
    expect(body.entry.entryDate).toBe('2026-03-10');
    expect(body.entry.memo).toContain('Reversión');
    expect(body.reverses.id).toBe(creado.body.entry.id);

    // No se reversa dos veces.
    await owner
      .as('post', `/api/v1/accounting/entries/${creado.body.entry.id}/reverse`)
      .send({ reason: 'Otra vez' })
      .expect(422);
  });

  it('y la contabilidad entera sigue cuadrando al final de todo', async () => {
    const totals = await globalBalance();
    expect(totals.debit).toBe(totals.credit);
    expect(Number(totals.debit)).toBeGreaterThan(0);
  });
});
