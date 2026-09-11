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
let bodega: string;

beforeAll(async () => {
  t = await makeTestApp();
  owner = await registerOrganization(t, { organizationName: 'Inventarios SAS' });

  const party = await owner
    .as('post', '/api/v1/parties')
    .send({ displayName: 'Supermercados La 14', taxId: '890903938' })
    .expect(201);
  cliente = party.body.id;

  const p1 = await owner
    .as('post', '/api/v1/products')
    .send({ name: 'Caja de producto', sku: 'CAJA-01', salePrice: '120000', purchasePrice: '80000' })
    .expect(201);
  producto = p1.body.id;

  const p2 = await owner
    .as('post', '/api/v1/products')
    .send({ name: 'Instalación', kind: 'SERVICE', sku: 'SERV-01', salePrice: '250000' })
    .expect(201);
  servicio = p2.body.id;

  const w = await owner.as('get', '/api/v1/inventory/warehouses/all').expect(200);
  bodega = w.body.items[0].id;
});

afterAll(async () => {
  await t.close();
});

/** Existencias y costo promedio leídos del listado, que es lo que ve el usuario. */
const nivel = async (productId = producto) => {
  const { body } = await owner
    .as('get', `/api/v1/inventory/stock?filter[warehouse_id]=${bodega}`)
    .expect(200);
  return (body.items as Array<Record<string, string>>).find((r) => r.product_id === productId);
};

/** La caché de saldos tiene que coincidir con la suma de los movimientos. */
const cacheCoincideConMovimientos = async (): Promise<void> => {
  const filas = await asTenant(t, owner, async (client) => {
    const { rows } = await client.query<{
      product_id: string;
      cached: string;
      summed: string;
    }>(
      `SELECT l.product_id, l.quantity::text AS cached,
              COALESCE((SELECT sum(m.quantity) FROM stock_moves m
                         WHERE m.product_id = l.product_id
                           AND m.warehouse_id = l.warehouse_id), 0)::text AS summed
         FROM stock_levels l`,
    );
    return rows;
  });
  for (const fila of filas) {
    expect(Number(fila.cached), `la caché de ${fila.product_id} no cuadra`).toBeCloseTo(
      Number(fila.summed),
      6,
    );
  }
};

// ═══════════════════════════════════════════════════════════════════════════
describe('la empresa nace con su bodega', () => {
  it('crea la bodega principal y la marca por defecto', async () => {
    const { body } = await owner.as('get', '/api/v1/inventory/warehouses/all').expect(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ code: 'PRIN', isDefault: true, isActive: true });
  });

  it('no admite dos bodegas por defecto', async () => {
    const nueva = await owner
      .as('post', '/api/v1/inventory/warehouses')
      .send({ code: 'SEC', name: 'Bodega secundaria', isDefault: true })
      .expect(201);

    const todas = await owner.as('get', '/api/v1/inventory/warehouses/all').expect(200);
    const porDefecto = (todas.body.items as Array<{ id: string; isDefault: boolean }>).filter(
      (w) => w.isDefault,
    );
    expect(porDefecto).toHaveLength(1);
    expect(porDefecto[0]?.id).toBe(nueva.body.id);

    // Se devuelve la marca a la principal para no alterar el resto de tests.
    await owner
      .as('patch', `/api/v1/inventory/warehouses/${bodega}`)
      .send({ isDefault: true })
      .expect(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('costo promedio contra la base real', () => {
  it('dos entradas a precios distintos dan el promedio ponderado', async () => {
    await owner
      .as('post', '/api/v1/inventory/stock/moves')
      .send({ productId: producto, quantity: '100', unitCost: '1000', kind: 'RECEIPT' })
      .expect(201);

    const segunda = await owner
      .as('post', '/api/v1/inventory/stock/moves')
      .send({ productId: producto, quantity: '50', unitCost: '1300', kind: 'RECEIPT' })
      .expect(201);

    // (100×1.000 + 50×1.300) / 150 = 1.100
    expect(segunda.body.balanceAfter).toBe('150');
    expect(segunda.body.averageAfter).toBe('1100.0000');

    const stock = await nivel();
    expect(stock?.quantity).toBe('150');
    expect(stock?.average_cost).toBe('1100.0000');
    expect(Number(stock?.value)).toBe(165000);
  });

  it('una salida usa el promedio vigente y no lo cambia', async () => {
    const salida = await owner
      .as('post', '/api/v1/inventory/stock/moves')
      .send({ productId: producto, quantity: '-60', kind: 'ISSUE' })
      .expect(201);

    expect(salida.body.unitCost).toBe('1100.0000');
    expect(salida.body.totalCost).toBe('-66000.0000');
    expect(salida.body.balanceAfter).toBe('90');
    // Vender no altera lo que costó lo que queda.
    expect(salida.body.averageAfter).toBe('1100.0000');
  });

  it('el kardex reconstruye la historia con su saldo en cada paso', async () => {
    const { body } = await owner
      .as('get', `/api/v1/inventory/stock/kardex?productId=${producto}`)
      .expect(200);

    const saldos = (body.items as Array<Record<string, string>>).map((m) => m.balanceAfter);
    expect(saldos).toEqual(['100', '150', '90']);
  });

  it('un movimiento no se puede modificar ni borrar, tampoco con SQL directo', async () => {
    const movimiento = await asTenant(t, owner, async (client) => {
      const { rows } = await client.query<{ id: string }>('SELECT id FROM stock_moves LIMIT 1');
      return rows[0]!.id;
    });

    await expect(
      asTenant(t, owner, (client) =>
        client.query('UPDATE stock_moves SET quantity = 999 WHERE id = $1', [movimiento]),
      ),
    ).rejects.toThrow(/no se modifica/);

    await expect(
      asTenant(t, owner, (client) =>
        client.query('DELETE FROM stock_moves WHERE id = $1', [movimiento]),
      ),
    ).rejects.toThrow(/no se borra/);
  });

  it('un servicio no tiene existencias', async () => {
    const { body } = await owner
      .as('post', '/api/v1/inventory/stock/moves')
      .send({ productId: servicio, quantity: '5', unitCost: '1000', kind: 'RECEIPT' })
      .expect(422);
    expect(body.error.message).toMatch(/es un servicio/);
  });

  it('no se saca más de lo que hay, y el mensaje dice cuánto hay', async () => {
    const { body } = await owner
      .as('post', '/api/v1/inventory/stock/moves')
      .send({ productId: producto, quantity: '-500', kind: 'ISSUE' })
      .expect(422);
    expect(body.error.message).toMatch(/90,?\.?00 disponibles/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('vender descuenta el inventario', () => {
  it('emitir la factura genera la salida, con el costo promedio', async () => {
    const antes = await nivel();
    expect(antes?.quantity).toBe('90');

    const draft = await owner
      .as('post', '/api/v1/invoices')
      .send({
        partyId: cliente,
        lines: [
          { productId: producto, quantity: '10' },
          // Una línea de servicio NO mueve inventario: si lo hiciera, el kardex
          // tendría horas de consultoría que nadie puede contar.
          { productId: servicio, quantity: '1' },
        ],
      })
      .expect(201);

    const factura = await owner
      .as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`)
      .expect(200);

    const despues = await nivel();
    expect(despues?.quantity).toBe('80');
    // El costo promedio no cambia al vender.
    expect(despues?.average_cost).toBe('1100.0000');

    const movimientos = await owner
      .as('get', `/api/v1/inventory/stock/moves?filter[source_id]=${draft.body.invoice.id}`)
      .expect(200);
    expect(movimientos.body.items).toHaveLength(1);
    expect(movimientos.body.items[0]).toMatchObject({
      kind: 'ISSUE',
      quantity: '-10',
      unit_cost: '1100.0000',
    });
    expect(String(movimientos.body.items[0].notes)).toContain(factura.body.invoice.number);
  });

  it('anular la factura devuelve la mercancía', async () => {
    const draft = await owner
      .as('post', '/api/v1/invoices')
      .send({ partyId: cliente, lines: [{ productId: producto, quantity: '5' }] })
      .expect(201);
    await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200);
    expect((await nivel())?.quantity).toBe('75');

    await owner
      .as('post', `/api/v1/invoices/${draft.body.invoice.id}/void`)
      .send({ reason: 'Pedido cancelado por el cliente' })
      .expect(200);

    expect((await nivel())?.quantity).toBe('80');

    // La devolución es un movimiento propio, no el borrado de la salida: el
    // kardex tiene que poder contar lo que pasó.
    const movimientos = await owner
      .as('get', `/api/v1/inventory/stock/moves?filter[source_id]=${draft.body.invoice.id}`)
      .expect(200);
    expect(movimientos.body.items).toHaveLength(2);
    expect(
      (movimientos.body.items as Array<Record<string, string>>).map((m) => m.kind).sort(),
    ).toEqual(['ISSUE', 'RETURN_IN']);
  });

  it('anular dos veces no duplica la mercancía', async () => {
    const antes = (await nivel())?.quantity;
    const draft = await owner
      .as('post', '/api/v1/invoices')
      .send({ partyId: cliente, lines: [{ productId: producto, quantity: '3' }] })
      .expect(201);
    await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200);
    await owner
      .as('post', `/api/v1/invoices/${draft.body.invoice.id}/void`)
      .send({ reason: 'Error de digitación' })
      .expect(200);
    // El segundo intento lo rechaza ventas, y el inventario no se toca.
    await owner
      .as('post', `/api/v1/invoices/${draft.body.invoice.id}/void`)
      .send({ reason: 'Otra vez' })
      .expect(422);

    expect((await nivel())?.quantity).toBe(antes);
  });

  it('la caché de saldos coincide con la suma de los movimientos', async () => {
    await cacheCoincideConMovimientos();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('conteo físico', () => {
  let conteo: string;

  it('abrir un conteo congela lo que dice el sistema', async () => {
    const { body } = await owner
      .as('post', '/api/v1/inventory/stock-counts')
      .send({ warehouseId: bodega, notes: 'Conteo de cierre de mes' })
      .expect(201);

    conteo = body.count.id;
    expect(body.count.status).toBe('COUNTING');
    const linea = (body.lines as Array<Record<string, string>>).find(
      (l) => l.productId === producto,
    );
    expect(linea?.expected).toBe('80');
    expect(linea?.counted).toBeNull();
  });

  it('una venta durante el conteo NO cambia lo esperado', async () => {
    // Es la razón de congelarlo: si `expected` se leyera al aplicar, este
    // movimiento quedaría tapado por el ajuste en lugar de verse.
    const draft = await owner
      .as('post', '/api/v1/invoices')
      .send({ partyId: cliente, lines: [{ productId: producto, quantity: '2' }] })
      .expect(201);
    await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200);

    const { body } = await owner.as('get', `/api/v1/inventory/stock-counts/${conteo}`).expect(200);
    const linea = (body.lines as Array<Record<string, string>>).find(
      (l) => l.productId === producto,
    );
    expect(linea?.expected).toBe('80');
    expect((await nivel())?.quantity).toBe('78');
  });

  it('registrar lo contado calcula la diferencia', async () => {
    const detalle = await owner.as('get', `/api/v1/inventory/stock-counts/${conteo}`).expect(200);
    const linea = (detalle.body.lines as Array<Record<string, string>>).find(
      (l) => l.productId === producto,
    )!;

    const { body } = await owner
      .as('patch', `/api/v1/inventory/stock-counts/${conteo}/lines/${linea.id}`)
      .send({ counted: '76', notes: 'Dos cajas averiadas' })
      .expect(200);

    const actualizada = (body.lines as Array<Record<string, string>>).find(
      (l) => l.productId === producto,
    );
    expect(actualizada?.counted).toBe('76');
    expect(actualizada?.difference).toBe('-4');
    expect(body.summary.withDifference).toBe(1);
  });

  it('aplicar el conteo genera el ajuste y deja el saldo en lo contado', async () => {
    const { body } = await owner
      .as('post', `/api/v1/inventory/stock-counts/${conteo}/apply`)
      .expect(200);

    expect(body.count.status).toBe('APPLIED');
    expect(body.count.number).toMatch(/^CONT-\d{5}$/);

    // Lo contado manda: 76, aunque el sistema dijera 78 en ese momento.
    expect((await nivel())?.quantity).toBe('76');
    // El ajuste no cambia el costo: un conteo mide unidades, no precios.
    expect((await nivel())?.average_cost).toBe('1100.0000');

    const ajustes = await owner
      .as('get', '/api/v1/inventory/stock/moves?filter[kind]=ADJUSTMENT')
      .expect(200);
    expect(ajustes.body.items.length).toBeGreaterThan(0);
    expect(String(ajustes.body.items[0].notes)).toContain(body.count.number);
  });

  it('un conteo aplicado no se edita ni se cancela', async () => {
    const detalle = await owner.as('get', `/api/v1/inventory/stock-counts/${conteo}`).expect(200);
    const linea = (detalle.body.lines as Array<Record<string, string>>)[0]!;

    const edicion = await owner
      .as('patch', `/api/v1/inventory/stock-counts/${conteo}/lines/${linea.id}`)
      .send({ counted: '999' })
      .expect(422);
    expect(edicion.body.error.message).toMatch(/ya se aplicó/);

    await owner.as('post', `/api/v1/inventory/stock-counts/${conteo}/cancel`).expect(422);
  });

  it('un conteo sin ninguna línea contada no se aplica', async () => {
    const vacio = await owner
      .as('post', '/api/v1/inventory/stock-counts')
      .send({ warehouseId: bodega })
      .expect(201);
    const { body } = await owner
      .as('post', `/api/v1/inventory/stock-counts/${vacio.body.count.id}/apply`)
      .expect(422);
    expect(body.error.message).toMatch(/ninguna línea contada/);
  });

  it('y todo sigue cuadrando al final', async () => {
    await cacheCoincideConMovimientos();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('ajustes manuales', () => {
  it('llevan las existencias a lo indicado y exigen motivo', async () => {
    const { body } = await owner
      .as('post', '/api/v1/inventory/stock/adjust')
      .send({ productId: producto, counted: '80', reason: 'Aparecieron cuatro cajas traspapeladas' })
      .expect(201);

    expect(body.quantity).toBe('4');
    expect(body.balanceAfter).toBe('80');
    expect((await nivel())?.quantity).toBe('80');
  });

  it('sin motivo no hay ajuste', async () => {
    await owner
      .as('post', '/api/v1/inventory/stock/adjust')
      .send({ productId: producto, counted: '90', reason: '   ' })
      .expect(400);
  });

  it('una bodega con movimientos no se borra', async () => {
    const { body } = await owner.as('delete', `/api/v1/inventory/warehouses/${bodega}`).expect(422);
    expect(body.error.message).toMatch(/no se puede borrar|bodega por defecto/);
  });
});
