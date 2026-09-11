import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  inviteMember,
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
  owner = await registerOrganization(t, { organizationName: 'Distribuidora Andina' });

  const party = await owner
    .as('post', '/api/v1/parties')
    .send({ displayName: 'Supermercados La 14', taxId: '890903938', email: 'compras@la14.co' })
    .expect(201);
  cliente = party.body.id;

  const p1 = await owner
    .as('post', '/api/v1/products')
    .send({ name: 'Caja de producto', sku: 'CAJA-01', salePrice: '120000', purchasePrice: '80000' })
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

/** Crea un borrador de factura con las líneas de la factura de referencia. */
const borrador = async (over: Record<string, unknown> = {}) =>
  owner
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

describe('numeraciones sembradas', () => {
  it('la empresa nace con sus consecutivos configurados', async () => {
    // Sin esto, el primer intento de emitir falla con "no hay numeración
    // configurada" justo cuando alguien intenta cobrar.
    const rows = await asTenant(t, owner, async (client) => {
      const result = await client.query<{ doc_type: string; prefix: string }>(
        'SELECT doc_type, prefix FROM document_sequences ORDER BY doc_type',
      );
      return result.rows;
    });
    expect(rows.map((r) => r.doc_type)).toEqual([
      'credit_note',
      'payment_in',
      'sales_invoice',
      'sales_quote',
    ]);
    expect(rows.find((r) => r.doc_type === 'sales_invoice')?.prefix).toBe('FV-');
  });
});

describe('facturas', () => {
  it('calcula los totales de la factura de referencia', async () => {
    // 10 × 120.000 = 1.200.000; 3 × 250.000 − 10 % = 675.000
    // Base 1.875.000 · IVA 356.250 · Total 2.231.250
    const { body } = await borrador();

    expect(body.invoice.status).toBe('DRAFT');
    expect(body.invoice.number).toBeNull();
    expect(body.invoice.subtotal).toBe('1875000.0000');
    expect(body.invoice.taxTotal).toBe('356250.0000');
    expect(body.invoice.total).toBe('2231250.0000');
    expect(body.effectiveStatus).toBe('DRAFT');
  });

  it('copia del producto la descripción, el código y el impuesto', async () => {
    const { body } = await borrador();
    const linea = body.lines[0];

    // Copiados, no referenciados: si el producto se renombra o cambia el IVA, la
    // factura tiene que seguir diciendo lo que decía.
    expect(linea.description).toBe('Caja de producto');
    expect(linea.sku).toBe('CAJA-01');
    expect(linea.uomCode).toBe('UND');
    expect(linea.unitPrice).toBe('120000.0000');
    expect(linea.taxes[0]).toMatchObject({ code: 'IVA19', rate: '19', amount: '228000.0000' });
  });

  it('el precio que manda el comercial gana sobre el del catálogo', async () => {
    // El comercial negocia; sobrescribirle el precio le obliga a facturar a mano.
    const { body } = await borrador({
      lines: [{ productId: producto, quantity: '1', unitPrice: '99000' }],
    });
    expect(body.lines[0].unitPrice).toBe('99000.0000');
    expect(body.invoice.subtotal).toBe('99000.0000');
  });

  it('calcula el vencimiento desde la fecha de emisión', async () => {
    const { body } = await borrador({ issueDate: '2026-01-15', paymentTermsDays: 30 });
    expect(body.invoice.issueDate).toBe('2026-01-15');
    expect(body.invoice.dueDate).toBe('2026-02-14');
  });

  it('rechaza una línea con un producto que no existe', async () => {
    const response = await owner
      .as('post', '/api/v1/invoices')
      .send({
        partyId: cliente,
        lines: [{ productId: '00000000-0000-0000-0000-000000000000', quantity: '1' }],
      })
      .expect(400);
    expect(response.body.error.message).toMatch(/no existe|archivados/);
  });

  it('rechaza una cantidad negativa', async () => {
    await owner
      .as('post', '/api/v1/invoices')
      .send({ partyId: cliente, lines: [{ productId: producto, quantity: '-1' }] })
      .expect(400);
  });
});

describe('emisión', () => {
  it('asigna el consecutivo AL EMITIR, no al crear', async () => {
    // Asignarlo antes deja huecos en cuanto alguien descarta un borrador, y un
    // hueco en la numeración fiscal hay que justificarlo ante la DIAN.
    const draft = await borrador();
    expect(draft.body.invoice.number).toBeNull();

    const issued = await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200);
    expect(issued.body.invoice.number).toMatch(/^FV-\d{6}$/);
    expect(issued.body.invoice.status).toBe('ISSUED');
    expect(issued.body.invoice.issuedAt).not.toBeNull();
  });

  it('los consecutivos son correlativos y sin repetir', async () => {
    const numeros: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const draft = await borrador();
      const issued = await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200);
      numeros.push(issued.body.invoice.number);
    }
    expect(new Set(numeros).size).toBe(3);
    const secuencia = numeros.map((n) => Number(n.replace('FV-', '')));
    expect(secuencia[1]).toBe(secuencia[0]! + 1);
    expect(secuencia[2]).toBe(secuencia[1]! + 1);
  });

  it('un borrador descartado NO consume consecutivo', async () => {
    const descartado = await borrador();
    await owner.as('delete', `/api/v1/invoices/${descartado.body.invoice.id}`).expect(204);

    const siguiente = await borrador();
    const issued = await owner.as('post', `/api/v1/invoices/${siguiente.body.invoice.id}/issue`).expect(200);
    expect(issued.body.invoice.number).toMatch(/^FV-\d{6}$/);
  });

  it('una factura emitida no se puede editar', async () => {
    const draft = await borrador();
    await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200);

    const response = await owner
      .as('patch', `/api/v1/invoices/${draft.body.invoice.id}`)
      .send({ notes: 'cambio' })
      .expect(422);
    expect(response.body.error.message).toMatch(/nota de crédito/);
  });

  it('una factura emitida no se puede borrar: ocupa un consecutivo', async () => {
    const draft = await borrador();
    await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200);

    const response = await owner.as('delete', `/api/v1/invoices/${draft.body.invoice.id}`).expect(422);
    expect(response.body.error.message).toMatch(/anúlala/);
  });

  it('no se emite una factura dos veces', async () => {
    const draft = await borrador();
    await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200);
    await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(422);
  });
});

describe('retenciones', () => {
  it('se aplican sobre el documento y respetan la base mínima', async () => {
    const conRetencion = await borrador({ withholdingCodes: ['RTF-COMP'] });

    // Base 1.875.000 > 1.377.000 (27 UVT), así que se retiene el 2,5 %.
    expect(conRetencion.body.invoice.withholdingTotal).toBe('46875.0000');
    // La factura sigue diciendo 2.231.250; el cliente transfiere menos.
    expect(conRetencion.body.invoice.total).toBe('2231250.0000');
    expect(conRetencion.body.invoice.netPayable).toBe('2184375.0000');
    expect(conRetencion.body.withholdings[0]).toMatchObject({ code: 'RTF-COMP', rate: '2.5' });
  });

  it('por debajo del mínimo se guarda la retención en cero, con su motivo', async () => {
    // Se guarda aunque sea cero: el contador pregunta "¿por qué no se retuvo?" y
    // la ficha tiene que poder responder.
    const pequeña = await borrador({
      lines: [{ productId: producto, quantity: '1', unitPrice: '500000' }],
      withholdingCodes: ['RTF-COMP'],
    });
    expect(pequeña.body.invoice.withholdingTotal).toBe('0.0000');
    expect(pequeña.body.withholdings).toHaveLength(1);
    expect(pequeña.body.withholdings[0].amount).toBe('0.0000');
  });

  it('rechaza un código que no es una retención', async () => {
    const response = await borrador({ withholdingCodes: ['IVA19'] }).catch((e: unknown) => e);
    const direct = await owner
      .as('post', '/api/v1/invoices')
      .send({ partyId: cliente, lines: [{ productId: producto, quantity: '1' }], withholdingCodes: ['IVA19'] })
      .expect(422);
    expect(direct.body.error.message).toMatch(/no es una retención/);
    expect(response).toBeDefined();
  });
});

describe('cotizaciones', () => {
  it('nace con número y se convierte conservando el precio negociado', async () => {
    const quote = await owner
      .as('post', '/api/v1/quotes')
      .send({
        partyId: cliente,
        validForDays: 15,
        lines: [{ productId: producto, quantity: '5', unitPrice: '95000' }],
      })
      .expect(201);

    expect(quote.body.quote.number).toMatch(/^COT-\d{5}$/);
    expect(quote.body.quote.status).toBe('DRAFT');
    expect(quote.body.quote.total).toBe('565250.0000'); // 475.000 + 19 %

    await owner.as('post', `/api/v1/quotes/${quote.body.quote.id}/status`).send({ status: 'SENT' }).expect(200);
    await owner
      .as('post', `/api/v1/quotes/${quote.body.quote.id}/status`)
      .send({ status: 'ACCEPTED' })
      .expect(200);

    const invoice = await owner.as('post', `/api/v1/quotes/${quote.body.quote.id}/convert`).expect(201);

    // El precio negociado se conserva: recalcularlo contra el catálogo cambiaría
    // el total de lo que el cliente ya aceptó.
    expect(invoice.body.lines[0].unitPrice).toBe('95000.0000');
    expect(invoice.body.invoice.total).toBe('565250.0000');
    expect(invoice.body.invoice.quoteId).toBe(quote.body.quote.id);

    const after = await owner.as('get', `/api/v1/quotes/${quote.body.quote.id}`).expect(200);
    expect(after.body.quote.status).toBe('CONVERTED');
    expect(after.body.quote.convertedInvoiceId).toBe(invoice.body.invoice.id);
  });

  it('una cotización convertida no se convierte otra vez', async () => {
    const quote = await owner
      .as('post', '/api/v1/quotes')
      .send({ partyId: cliente, lines: [{ productId: producto, quantity: '1' }] })
      .expect(201);
    await owner.as('post', `/api/v1/quotes/${quote.body.quote.id}/status`).send({ status: 'ACCEPTED' }).expect(200);
    await owner.as('post', `/api/v1/quotes/${quote.body.quote.id}/convert`).expect(201);

    const response = await owner.as('post', `/api/v1/quotes/${quote.body.quote.id}/convert`).expect(422);
    expect(response.body.error.message).toMatch(/crea una nueva/);
  });

  it('respeta la máquina de estados', async () => {
    const quote = await owner
      .as('post', '/api/v1/quotes')
      .send({ partyId: cliente, lines: [{ productId: producto, quantity: '1' }] })
      .expect(201);

    // De borrador no se salta a convertida.
    await owner
      .as('post', `/api/v1/quotes/${quote.body.quote.id}/convert`)
      .expect(422);
    // El cliente se echa atrás tras aceptar: eso sí pasa.
    await owner.as('post', `/api/v1/quotes/${quote.body.quote.id}/status`).send({ status: 'ACCEPTED' }).expect(200);
    await owner.as('post', `/api/v1/quotes/${quote.body.quote.id}/status`).send({ status: 'REJECTED' }).expect(200);
  });

  it('marca como vencida la que pasó su fecha de validez', async () => {
    // El reloj de los tests está en marzo de 2026.
    const quote = await owner
      .as('post', '/api/v1/quotes')
      .send({ partyId: cliente, issueDate: '2026-01-01', validForDays: 15, lines: [{ productId: producto, quantity: '1' }] })
      .expect(201);
    const detail = await owner.as('get', `/api/v1/quotes/${quote.body.quote.id}`).expect(200);
    expect(detail.body.isExpired).toBe(true);
  });
});

describe('pagos', () => {
  let f1: string;
  let f2: string;

  beforeAll(async () => {
    const cobrable = await registerOrganization(t, { organizationName: 'Solo para pagos' });
    void cobrable;

    const a = await borrador({ issueDate: '2026-01-10', paymentTermsDays: 30 });
    const b = await borrador({ issueDate: '2026-02-10', paymentTermsDays: 30 });
    f1 = (await owner.as('post', `/api/v1/invoices/${a.body.invoice.id}/issue`).expect(200)).body.invoice.id;
    f2 = (await owner.as('post', `/api/v1/invoices/${b.body.invoice.id}/issue`).expect(200)).body.invoice.id;
  });

  it('lista las facturas abiertas del cliente', async () => {
    const { body } = await owner.as('get', `/api/v1/parties/${cliente}/open-invoices`).expect(200);
    const ids = body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(f1);
    expect(ids).toContain(f2);
  });

  it('imputa de la factura más antigua a la más reciente', async () => {
    const { body } = await owner
      .as('post', '/api/v1/payments')
      .send({ partyId: cliente, amount: '2231250', paymentDate: '2026-03-01', reference: 'TRF-001' })
      .expect(201);

    expect(body.payment.number).toMatch(/^RC-\d{5}$/);
    expect(body.allocations.length).toBeGreaterThan(0);

    // La primera factura queda saldada.
    const factura = await owner.as('get', `/api/v1/invoices/${f1}`).expect(200);
    expect(factura.body.invoice.paidTotal).toBe('2231250.0000');
    expect(factura.body.effectiveStatus).toBe('PAID');
    expect(factura.body.outstanding).toBe('0.0000');
    expect(factura.body.payments).toHaveLength(1);
  });

  it('un abono parcial deja la factura con saldo', async () => {
    await owner
      .as('post', '/api/v1/payments')
      .send({ partyId: cliente, amount: '1000000', allocations: [{ invoiceId: f2, amount: '1000000' }] })
      .expect(201);

    const factura = await owner.as('get', `/api/v1/invoices/${f2}`).expect(200);
    expect(factura.body.invoice.paidTotal).toBe('1000000.0000');
    expect(factura.body.outstanding).toBe('1231250.0000');
    expect(factura.body.effectiveStatus).toBe('PARTIALLY_PAID');
  });

  it('no deja imputar más de lo que la factura debe', async () => {
    const response = await owner
      .as('post', '/api/v1/payments')
      .send({ partyId: cliente, amount: '5000000', allocations: [{ invoiceId: f2, amount: '5000000' }] })
      .expect(422);
    expect(response.body.error.message).toMatch(/pagada de más/);
  });

  it('el sobrante queda sin imputar, como saldo a favor', async () => {
    const nueva = await borrador({ lines: [{ productId: producto, quantity: '1' }] });
    const id = (await owner.as('post', `/api/v1/invoices/${nueva.body.invoice.id}/issue`).expect(200)).body
      .invoice.id;

    const { body } = await owner
      .as('post', '/api/v1/payments')
      .send({ partyId: cliente, amount: '100000000' })
      .expect(201);

    expect(Number(body.unapplied)).toBeGreaterThan(0);
    const factura = await owner.as('get', `/api/v1/invoices/${id}`).expect(200);
    expect(factura.body.outstanding).toBe('0.0000');
  });

  it('anular un pago devuelve el saldo a sus facturas', async () => {
    const nueva = await borrador({ lines: [{ productId: producto, quantity: '2' }] });
    const id = (await owner.as('post', `/api/v1/invoices/${nueva.body.invoice.id}/issue`).expect(200)).body
      .invoice.id;
    const total = (await owner.as('get', `/api/v1/invoices/${id}`).expect(200)).body.invoice.total;

    const pago = await owner
      .as('post', '/api/v1/payments')
      .send({ partyId: cliente, amount: total, allocations: [{ invoiceId: id, amount: total }] })
      .expect(201);

    expect((await owner.as('get', `/api/v1/invoices/${id}`)).body.effectiveStatus).toBe('PAID');

    await owner
      .as('post', `/api/v1/payments/${pago.body.payment.id}/void`)
      .send({ reason: 'Cheque devuelto' })
      .expect(200);

    // El saldo se RECALCULA desde las imputaciones vigentes: un contador que se
    // acumula se habría quedado con la factura pagada.
    const despues = await owner.as('get', `/api/v1/invoices/${id}`).expect(200);
    expect(despues.body.invoice.paidTotal).toBe('0.0000');
    expect(despues.body.payments).toHaveLength(0);
  });

  it('anular exige un motivo y no se hace dos veces', async () => {
    const pago = await owner
      .as('post', '/api/v1/payments')
      .send({ partyId: cliente, amount: '50000' })
      .expect(201);

    await owner.as('post', `/api/v1/payments/${pago.body.payment.id}/void`).send({ reason: '' }).expect(400);
    await owner.as('post', `/api/v1/payments/${pago.body.payment.id}/void`).send({ reason: 'Error' }).expect(200);
    await owner.as('post', `/api/v1/payments/${pago.body.payment.id}/void`).send({ reason: 'Otra vez' }).expect(422);
  });
});

describe('anulación de facturas', () => {
  it('una factura sin pagos se anula con motivo', async () => {
    const draft = await borrador();
    const id = (await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200)).body
      .invoice.id;

    const response = await owner
      .as('post', `/api/v1/invoices/${id}/void`)
      .send({ reason: 'Datos del cliente equivocados' })
      .expect(200);

    expect(response.body.invoice.status).toBe('VOID');
    expect(response.body.effectiveStatus).toBe('VOID');
    expect(response.body.invoice.voidReason).toBe('Datos del cliente equivocados');
  });

  it('una factura con pagos NO se anula: se corrige con nota de crédito', async () => {
    const draft = await borrador({ lines: [{ productId: producto, quantity: '1' }] });
    const id = (await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200)).body
      .invoice.id;
    await owner
      .as('post', '/api/v1/payments')
      .send({ partyId: cliente, amount: '10000', allocations: [{ invoiceId: id, amount: '10000' }] })
      .expect(201);

    const response = await owner.as('post', `/api/v1/invoices/${id}/void`).send({ reason: 'Cobro duplicado' }).expect(422);
    expect(response.body.error.message).toMatch(/nota de crédito/);
  });

  it('anular exige un motivo', async () => {
    const draft = await borrador();
    const id = (await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200)).body
      .invoice.id;
    await owner.as('post', `/api/v1/invoices/${id}/void`).send({ reason: '' }).expect(400);
  });
});

describe('cartera', () => {
  it('el resumen y la antigüedad usan el mismo filtro de alcance', async () => {
    const overview = await owner.as('get', '/api/v1/invoices/overview').expect(200);
    expect(overview.body.issuedCount).toBeGreaterThan(0);
    expect(Number(overview.body.outstanding)).toBeGreaterThanOrEqual(0);

    const aging = await owner.as('get', '/api/v1/invoices/aging').expect(200);
    expect(aging.body.items.length).toBeGreaterThan(0);
    const fila = aging.body.items[0];
    expect(fila).toHaveProperty('partyName');
    // Los tramos suman el total.
    const suma = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'].reduce(
      (acc, key) => acc + Number(fila[key]),
      0,
    );
    expect(suma).toBeCloseTo(Number(fila.total), 2);
  });

  it('usa el reloj de la aplicación, no el de la base', async () => {
    // El reloj de los tests está fijo en el 10 de marzo de 2026. Una factura con
    // vencimiento en enero tiene que salir vencida y con sus días de mora
    // contados desde ESA fecha. Tomando `current_date` de PostgreSQL, el listado
    // clasificaría con la fecha real del servidor y la ficha con la del reloj:
    // la misma factura saldría vencida en la lista y al día al abrirla.
    const draft = await borrador({ issueDate: '2026-01-01', paymentTermsDays: 10 });
    const id = (await owner.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(200)).body
      .invoice.id;

    const ficha = await owner.as('get', `/api/v1/invoices/${id}`).expect(200);
    const numero = ficha.body.invoice.number as string;

    const lista = await owner
      .as('get', `/api/v1/invoices?filter[number]=${encodeURIComponent(numero)}`)
      .expect(200);

    const fila = lista.body.items[0];
    expect(fila.effective_status).toBe('OVERDUE');
    // Del 11 de enero al 10 de marzo hay 58 días.
    expect(fila.days_overdue).toBe(58);
    expect(ficha.body.effectiveStatus).toBe('OVERDUE');
  });

  it('el listado filtra por estado efectivo, no por el almacenado', async () => {
    // "Muéstrame lo vencido" no se puede responder con la columna guardada.
    const vencidas = await owner.as('get', '/api/v1/invoices?filter[effective_status]=OVERDUE').expect(200);
    for (const item of vencidas.body.items) {
      expect(item.effective_status).toBe('OVERDUE');
      expect(item.days_overdue).toBeGreaterThan(0);
    }
  });
});

describe('permisos', () => {
  it('crear una factura no permite emitirla', async () => {
    // Emitir es el acto que la hace existir para la DIAN: es un permiso aparte.
    const role = await owner
      .as('post', '/api/v1/roles')
      .send({
        name: 'Facturador sin emisión',
        permissions: [
          { key: 'sales:invoice:read', scope: 'ORG' },
          { key: 'sales:invoice:create', scope: 'ORG' },
          { key: 'catalog:product:read', scope: 'ORG' },
          { key: 'catalog:tax:read', scope: 'ORG' },
          { key: 'crm:party:read', scope: 'ORG' },
        ],
      })
      .expect(201);

    const auxiliar = await inviteMember(t, owner, {});
    await owner
      .as('put', `/api/v1/members/${auxiliar.membershipId}/roles`)
      .send({ roleIds: [role.body.id] })
      .expect(204);

    const draft = await auxiliar
      .as('post', '/api/v1/invoices')
      .send({ partyId: cliente, lines: [{ productId: producto, quantity: '1' }] })
      .expect(201);

    await auxiliar.as('post', `/api/v1/invoices/${draft.body.invoice.id}/issue`).expect(403);
    await auxiliar.as('post', `/api/v1/invoices/${draft.body.invoice.id}/void`).send({ reason: 'Motivo cualquiera' }).expect(403);
  });
});
