import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asTenant, makeTestApp, registerOrganization, type Account, type TestApp } from '../helpers.js';

let t: TestApp;
let owner: Account;
let proveedor: string;
let cliente: string;
let producto: string;
let bodega: string;

beforeAll(async () => {
  t = await makeTestApp();
  owner = await registerOrganization(t, { organizationName: 'Compras SAS' });

  const p = await owner
    .as('post', '/api/v1/parties')
    .send({ displayName: 'Importadora del Caribe', taxId: '900123456' })
    .expect(201);
  proveedor = p.body.id;

  const c = await owner
    .as('post', '/api/v1/parties')
    .send({ displayName: 'Tienda La Esquina', taxId: '890903938' })
    .expect(201);
  cliente = c.body.id;

  const prod = await owner
    .as('post', '/api/v1/products')
    .send({ name: 'Caja de producto', sku: 'CAJA-01', salePrice: '120000', purchasePrice: '80000' })
    .expect(201);
  producto = prod.body.id;

  const w = await owner.as('get', '/api/v1/inventory/warehouses/all').expect(200);
  bodega = w.body.items[0].id;
});

afterAll(async () => {
  await t.close();
});

const stock = async (): Promise<{ quantity: string; average_cost: string } | undefined> => {
  const { body } = await owner.as('get', '/api/v1/inventory/stock').expect(200);
  return (body.items as Array<Record<string, string>>).find((r) => r.product_id === producto) as
    | { quantity: string; average_cost: string }
    | undefined;
};

const balanceaTodo = async (): Promise<void> => {
  const rows = await asTenant(t, owner, async (client) => {
    const { rows } = await client.query<{ debit: string; credit: string }>(
      `SELECT coalesce(sum(base_debit), 0)::text AS debit,
              coalesce(sum(base_credit), 0)::text AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED'`,
    );
    return rows;
  });
  expect(rows[0]?.debit).toBe(rows[0]?.credit);
};

// ═══════════════════════════════════════════════════════════════════════════
describe('el ciclo de compra son tres documentos', () => {
  let orden: string;
  let ordenLinea: string;
  let recepcion: string;

  it('la orden dice lo que se pidió, y no mueve nada', async () => {
    const { body } = await owner
      .as('post', '/api/v1/purchasing/orders')
      .send({
        partyId: proveedor,
        warehouseId: bodega,
        expectedDate: '2026-03-20',
        lines: [{ productId: producto, quantity: '10', unitPrice: '80000' }],
      })
      .expect(201);

    orden = body.order.id;
    ordenLinea = body.lines[0].id;
    expect(body.order.status).toBe('DRAFT');
    expect(body.order.total).toBe('952000.0000'); // 800.000 + 19 %
    // Una orden es una intención: el inventario sigue vacío.
    expect(await stock()).toBeUndefined();
  });

  it('enviarla le asigna el consecutivo', async () => {
    const { body } = await owner.as('post', `/api/v1/purchasing/orders/${orden}/send`).expect(200);
    expect(body.order.number).toMatch(/^OC-\d{5}$/);
    expect(body.order.status).toBe('SENT');
  });

  it('una orden enviada no se borra: se cancela', async () => {
    const { body } = await owner.as('delete', `/api/v1/purchasing/orders/${orden}`).expect(422);
    expect(body.error.message).toMatch(/cancélala en vez de borrarla/);
  });

  it('la recepción dice lo que llegó, y SÍ mueve el inventario', async () => {
    const creada = await owner
      .as('post', '/api/v1/purchasing/receipts')
      .send({
        partyId: proveedor,
        orderId: orden,
        warehouseId: bodega,
        reference: 'GUIA-4471',
        lines: [
          { orderLineId: ordenLinea, productId: producto, quantity: '8', unitCost: '80000' },
        ],
      })
      .expect(201);
    recepcion = creada.body.receipt.id;

    // Un borrador de recepción tampoco mueve nada.
    expect(await stock()).toBeUndefined();

    const { body } = await owner
      .as('post', `/api/v1/purchasing/receipts/${recepcion}/post`)
      .expect(200);
    expect(body.receipt.number).toMatch(/^ENT-\d{5}$/);

    const nivel = await stock();
    expect(nivel?.quantity).toBe('8');
    expect(nivel?.average_cost).toBe('80000.0000');
  });

  it('la orden queda recibida en parte, no completa', async () => {
    const { body } = await owner.as('get', `/api/v1/purchasing/orders/${orden}`).expect(200);
    expect(body.order.status).toBe('PARTIAL');
    expect(body.lines[0].received).toBe('8');
    expect(body.lines[0].pending).toBe('2');
  });

  it('recibir mucho más de lo pedido se rechaza', async () => {
    const { body } = await owner
      .as('post', '/api/v1/purchasing/receipts')
      .send({
        partyId: proveedor,
        orderId: orden,
        warehouseId: bodega,
        lines: [{ orderLineId: ordenLinea, productId: producto, quantity: '5', unitCost: '80000' }],
      })
      .expect(422);
    expect(body.error.message).toMatch(/tolerancia/);
  });

  it('pero un poco de más se permite: los proveedores despachan por empaque', async () => {
    await owner
      .as('post', '/api/v1/purchasing/receipts')
      .send({
        partyId: proveedor,
        orderId: orden,
        warehouseId: bodega,
        lines: [{ orderLineId: ordenLinea, productId: producto, quantity: '3', unitCost: '80000' }],
      })
      .expect(201);
  });

  it('anular la recepción devuelve la mercancía y reabre la orden', async () => {
    await owner
      .as('post', `/api/v1/purchasing/receipts/${recepcion}/void`)
      .send({ reason: 'Mercancía averiada, devuelta al proveedor' })
      .expect(200);

    expect((await stock())?.quantity).toBe('0');

    const { body } = await owner.as('get', `/api/v1/purchasing/orders/${orden}`).expect(200);
    expect(body.order.status).toBe('SENT');
    expect(body.lines[0].received).toBe('0');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('facturas de proveedor', () => {
  let factura: string;

  it('exigen el número del proveedor y no admiten duplicados', async () => {
    const creada = await owner
      .as('post', '/api/v1/purchasing/bills')
      .send({
        supplierNumber: 'FV-9001',
        partyId: proveedor,
        paymentTermsDays: 30,
        lines: [{ productId: producto, quantity: '10', unitPrice: '80000' }],
      })
      .expect(201);
    factura = creada.body.bill.id;
    expect(creada.body.bill.total).toBe('952000.0000');

    // Pagar dos veces la misma factura es el error de cuentas por pagar más
    // caro y más común: la segunda no entra.
    const { body } = await owner
      .as('post', '/api/v1/purchasing/bills')
      .send({
        supplierNumber: 'FV-9001',
        partyId: proveedor,
        lines: [{ productId: producto, quantity: '1', unitPrice: '80000' }],
      })
      .expect(409);
    expect(body.error.message).toMatch(/pagarla dos veces/);
  });

  it('otro proveedor sí puede usar el mismo número', async () => {
    const otro = await owner
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Distribuidora Norte' })
      .expect(201);
    await owner
      .as('post', '/api/v1/purchasing/bills')
      .send({
        supplierNumber: 'FV-9001',
        partyId: otro.body.id,
        lines: [{ productId: producto, quantity: '1', unitPrice: '50000' }],
      })
      .expect(201);
  });

  it('una línea sin producto tiene que decir a qué cuenta va', async () => {
    const { body } = await owner
      .as('post', '/api/v1/purchasing/bills')
      .send({
        supplierNumber: 'FV-9002',
        partyId: proveedor,
        lines: [{ description: 'Arrendamiento de marzo', quantity: '1', unitPrice: '2000000' }],
      })
      .expect(400);
    expect(body.error.message).toMatch(/cuenta de gasto o costo/);
  });

  it('contabilizarla genera su asiento, con las retenciones como pasivo', async () => {
    const impuestos = await owner.as('get', '/api/v1/taxes').expect(200);
    const reteFuente = (impuestos.body.items as Array<Record<string, string>>).find(
      (tax) => tax.code === 'RTF-COMPRAS',
    );

    const conRetencion = await owner
      .as('post', '/api/v1/purchasing/bills')
      .send({
        supplierNumber: 'FV-9003',
        partyId: proveedor,
        lines: [{ productId: producto, quantity: '10', unitPrice: '100000' }],
        ...(reteFuente ? { withholdingTaxIds: [reteFuente.id] } : {}),
      })
      .expect(201);

    const posted = await owner
      .as('post', `/api/v1/purchasing/bills/${conRetencion.body.bill.id}/post`)
      .expect(200);
    expect(posted.body.bill.number).toMatch(/^FC-\d{6}$/);

    const asiento = await owner
      .as('get', `/api/v1/accounting/entries/by-source/purchase_bill/${conRetencion.body.bill.id}`)
      .expect(200);

    expect(asiento.body.entry.journalCode).toBe('CP');
    expect(asiento.body.entry.debitTotal).toBe(asiento.body.entry.creditTotal);

    const byCode = new Map(
      (asiento.body.lines as Array<Record<string, string>>).map((l) => [l.accountCode, l]),
    );
    // IVA descontable al débito: es un activo, no un gasto.
    expect(byCode.get('240810')?.debit).toBe('190000.0000');
    // Proveedores al crédito, ya neto de la retención practicada.
    expect(byCode.has('220505')).toBe(true);
    if (reteFuente) {
      // La retención practicada es un PASIVO: hay que consignarla a la DIAN.
      expect(byCode.get('236540')?.credit).toBeDefined();
    }
  });

  it('la factura con pagos no se anula', async () => {
    await owner.as('post', `/api/v1/purchasing/bills/${factura}/post`).expect(200);
    const { body } = await owner
      .as('post', `/api/v1/purchasing/bills/${factura}/void`)
      .send({ reason: 'Error' })
      .expect(200);
    expect(body.bill.status).toBe('VOID');
  });

  it('anular una factura contabilizada la reversa, no la borra', async () => {
    const asiento = await owner
      .as('get', `/api/v1/accounting/entries/by-source/purchase_bill/${factura}`)
      .expect(200);
    expect(asiento.body.entry.reversedById).not.toBeNull();
  });

  it('las cuentas por pagar salen por edades', async () => {
    const { body } = await owner.as('get', '/api/v1/purchasing/bills/payable').expect(200);
    expect(body.items.length).toBeGreaterThan(0);
    const fila = (body.items as Array<Record<string, string>>).find(
      (r) => r.partyName === 'Importadora del Caribe',
    );
    expect(Number(fila?.total)).toBeGreaterThan(0);
  });

  it('y toda la contabilidad cuadra', async () => {
    await balanceaTodo();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('vender reconoce el costo de la mercancía', () => {
  it('el costo va a su propio asiento, separado del ingreso', async () => {
    // Se repone inventario para poder vender con costo conocido.
    const recepcion = await owner
      .as('post', '/api/v1/purchasing/receipts')
      .send({
        partyId: proveedor,
        warehouseId: bodega,
        lines: [{ productId: producto, quantity: '20', unitCost: '80000' }],
      })
      .expect(201);
    await owner
      .as('post', `/api/v1/purchasing/receipts/${recepcion.body.receipt.id}/post`)
      .expect(200);

    const draft = await owner
      .as('post', '/api/v1/invoices')
      .send({ partyId: cliente, lines: [{ productId: producto, quantity: '5' }] })
      .expect(201);
    const factura = await owner
      .as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`)
      .expect(200);

    const asientos = await owner
      .as('get', `/api/v1/accounting/entries?filter[source_type]=cost_of_goods`)
      .expect(200);

    const costo = (asientos.body.items as Array<Record<string, string>>).find((e) =>
      String(e.memo).includes(String(factura.body.invoice.number)),
    );
    expect(costo, 'no se contabilizó el costo de la venta').toBeDefined();
    // 5 unidades × 80.000 de costo promedio.
    expect(costo?.debit_total).toBe('400000.0000');
    expect(costo?.journal_code).toBe('IN');

    // Y el asiento de la factura, aparte, registra el INGRESO.
    const ingreso = await owner
      .as('get', `/api/v1/accounting/entries/by-source/sales_invoice/${draft.body.invoice.id}`)
      .expect(200);
    const cuentas = (ingreso.body.lines as Array<Record<string, string>>).map((l) => l.accountCode);
    expect(cuentas).toContain('413595');
    // El costo NO está en el asiento de la factura: son dos hechos distintos.
    expect(cuentas).not.toContain('613595');
  });

  it('el ingreso y el costo de la venta quedan en sus cuentas del PUC', async () => {
    const { body } = await owner
      .as('get', '/api/v1/accounting/reports/income-statement?from=2026-01-01&to=2026-12-31')
      .expect(200);

    /*
     * Se comprueban las CUENTAS, no el total de la clase.
     *
     * La clase 6 incluye también las compras de esta misma suite (620505), que
     * son costo igualmente. Afirmar sobre el total haría que este test fallara
     * cada vez que alguien añadiera una factura de compra en otro test, sin que
     * nada estuviera mal.
     */
    const find = (code: string): { debit: string; credit: string } | undefined => {
      const walk = (nodes: Array<Record<string, unknown>>): Record<string, unknown> | undefined => {
        for (const node of nodes) {
          if (node.code === code) return node;
          const hit = walk((node.children ?? []) as Array<Record<string, unknown>>);
          if (hit) return hit;
        }
        return undefined;
      };
      return walk(body.rows as Array<Record<string, unknown>>) as
        | { debit: string; credit: string }
        | undefined;
    };

    // 5 × 120.000 de ingreso, 5 × 80.000 de costo promedio.
    expect(Number(find('413595')?.credit)).toBe(600000);
    expect(Number(find('613595')?.debit)).toBe(400000);
  });

  it('y la contabilidad entera sigue cuadrando', async () => {
    await balanceaTodo();
  });
});
