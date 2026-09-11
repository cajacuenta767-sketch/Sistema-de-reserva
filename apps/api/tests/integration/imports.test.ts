import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inviteMember, makeTestApp, registerOrganization, type Account, type TestApp } from '../helpers.js';

let t: TestApp;
let owner: Account;

beforeAll(async () => {
  t = await makeTestApp();
  owner = await registerOrganization(t, { organizationName: 'Distribuidora Andina' });
});
afterAll(async () => {
  await t.close();
});

/** Sube un CSV y devuelve la vista previa. */
const upload = async (entityType: string, content: string, filename = 'datos.csv') =>
  owner.as('post', '/api/v1/imports').send({ entityType, filename, content }).expect(201);

describe('catálogo de importadores', () => {
  it('lista lo que se puede importar, con sus campos', async () => {
    const { body } = await owner.as('get', '/api/v1/imports/catalog').expect(200);
    const types = body.items.map((i: { entityType: string }) => i.entityType);
    expect(types).toContain('party');
    expect(types).toContain('product');

    const party = body.items.find((i: { entityType: string }) => i.entityType === 'party');
    expect(party.fields.find((f: { key: string }) => f.key === 'displayName').required).toBe(true);
  });

  it('solo muestra lo que el usuario puede crear', async () => {
    // El comercial puede crear clientes pero no productos: su catálogo de
    // importación tiene que reflejarlo, no ofrecerle algo que acabará en 403.
    const seller = await inviteMember(t, owner, { roleCodes: ['SALES'] });
    const { body } = await seller.as('get', '/api/v1/imports/catalog').expect(200);
    const types = body.items.map((i: { entityType: string }) => i.entityType);
    expect(types).toContain('party');
    expect(types).not.toContain('product');
  });
});

describe('subida y mapeo', () => {
  it('propone el mapeo a partir de las cabeceras', async () => {
    const { body } = await upload(
      'party',
      'Razón social,Documento,Correo electrónico\nAcme S.A.S.,900123456,hola@acme.co',
    );

    expect(body.job.totalRows).toBe(1);
    expect(body.job.status).toBe('READY');
    expect(body.job.mapping).toMatchObject({
      displayName: 'Razón social',
      taxId: 'Documento',
      email: 'Correo electrónico',
    });
    expect(body.missing).toEqual([]);
    expect(body.sample[0]).toEqual({
      'Razón social': 'Acme S.A.S.',
      Documento: '900123456',
      'Correo electrónico': 'hola@acme.co',
    });
  });

  it('señala los campos obligatorios que no reconoce', async () => {
    const { body } = await upload('party', 'Columna A,Columna B\nfoo,bar');
    expect(body.job.mapping).toEqual({});
    expect(body.missing).toEqual(['Nombre']);
  });

  it('no deja ejecutar sin los obligatorios asignados', async () => {
    const { body } = await upload('party', 'Columna A,Columna B\nfoo,bar');
    const response = await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(400);
    expect(response.body.error.message).toMatch(/Faltan columnas obligatorias.*Nombre/);
  });

  it('deja corregir el mapeo a mano', async () => {
    const { body } = await upload('party', 'Columna A,Columna B\nFerretería El Tornillo,900123456');

    const fixed = await owner
      .as('patch', `/api/v1/imports/${body.job.id}/mapping`)
      .send({ mapping: { displayName: 'Columna A', taxId: 'Columna B' } })
      .expect(200);
    expect(fixed.body.missing).toEqual([]);

    const run = await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);
    expect(run.body.imported).toBe(1);
  });

  it('entiende el punto y coma y las comillas de Excel en español', async () => {
    const csv = [
      'Nombre;Documento;Notas',
      '"Comercial Los Andes, S.A.S.";890903938;"Dirección: Calle 10 # 5-20, Bogotá"',
    ].join('\n');
    const { body } = await upload('party', csv);

    expect(body.delimiter).toBe(';');
    expect(body.sample[0].Nombre).toBe('Comercial Los Andes, S.A.S.');
    expect(body.sample[0].Notas).toContain('Bogotá');
  });

  it('rechaza un fichero sin filas', async () => {
    await owner
      .as('post', '/api/v1/imports')
      .send({ entityType: 'party', filename: 'vacio.csv', content: 'nombre,nit\n' })
      .expect(400);
  });

  it('rechaza una entidad que nadie sabe importar', async () => {
    const response = await owner
      .as('post', '/api/v1/imports')
      .send({ entityType: 'unicornios', filename: 'x.csv', content: 'a\n1' })
      .expect(400);
    expect(response.body.error.details.disponibles).toContain('party');
  });
});

describe('ejecución', () => {
  it('crea los registros pasando por el caso de uso real', async () => {
    const csv = [
      'Nombre,Documento,Correo,Celular',
      'Bancolombia S.A.,890903938,tesoreria@banco.co,3001112233',
      'Ecopetrol S.A.,899999068,compras@eco.co,3004445566',
    ].join('\n');
    const { body } = await upload('party', csv);
    const run = await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);

    expect(run.body.imported).toBe(2);
    expect(run.body.failed).toBe(0);
    expect(run.body.job.status).toBe('DONE');

    // El DV se calculó igual que en el formulario: no hay una vía rápida que se
    // salte la validación.
    const list = await owner.as('get', '/api/v1/parties?q=Bancolombia').expect(200);
    expect(list.body.items[0]).toMatchObject({ tax_id: '890903938', tax_id_dv: '8' });
  });

  it('una fila mala no tumba las buenas', async () => {
    // El caso que justifica el SAVEPOINT por fila: en PostgreSQL un error aborta
    // la transacción entera, así que sin aislar cada fila el primer NIT inválido
    // haría fracasar todas las que van detrás.
    const csv = [
      'Nombre,Documento,DV,Correo',
      'Primera correcta,860002964,,uno@test.co',
      'NIT con DV mal,900123456,3,dos@test.co',
      'Segunda correcta,811021438,,tres@test.co',
      'Correo inválido,830025281,,esto-no-es-un-correo',
      'Tercera correcta,860076580,,cinco@test.co',
    ].join('\n');
    const { body } = await upload('party', csv);
    const run = await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);

    expect(run.body.imported).toBe(3);
    expect(run.body.failed).toBe(2);
    expect(run.body.job.status).toBe('DONE');

    // Y las tres correctas existen de verdad.
    for (const nombre of ['Primera correcta', 'Segunda correcta', 'Tercera correcta']) {
      const found = await owner.as('get', `/api/v1/parties?q=${encodeURIComponent(nombre)}`).expect(200);
      expect(found.body.total, nombre).toBe(1);
    }
  });

  it('el informe da el número de fila del fichero y el motivo', async () => {
    const csv = ['Nombre,Documento,DV', 'Buena,900555444,', 'Mala,900123456,3'].join('\n');
    const { body } = await upload('party', csv);
    await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);

    const rows = await owner
      .as('get', `/api/v1/imports/${body.job.id}/rows?filter[status]=ERROR`)
      .expect(200);
    expect(rows.body.items).toHaveLength(1);
    // Fila 3 del fichero: la 1 es la cabecera. El número tiene que coincidir con
    // el que se ve en Excel, o buscar el error es adivinar.
    expect(rows.body.items[0].row_no).toBe(3);
    expect(rows.body.items[0].error).toMatch(/debería ser/);
    expect(rows.body.items[0].raw.Nombre).toBe('Mala');

    const all = await owner.as('get', `/api/v1/imports/${body.job.id}/rows`).expect(200);
    expect(all.body.aggregates).toMatchObject({ ok: 1, errors: 1 });
    expect(all.body.items.find((r: { row_no: number }) => r.row_no === 2).created_entity_id).toBeTruthy();
  });

  it('importa productos con precios en formato español', async () => {
    // El error que más daño hace en una importación: `Number('89.900')` da 89,9
    // y el precio queda mil veces por debajo sin que nada falle.
    const csv = [
      'Producto,Referencia,Precio,Costo,Unidad',
      'Camisa de algodón,CAM-001,"89.900","52.400",UND',
      'Pantalón de dril,PAN-001,"120.000","71.500",UND',
    ].join('\n');
    const { body } = await upload('product', csv, 'productos.csv');
    const run = await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);
    expect(run.body.imported).toBe(2);

    const list = await owner.as('get', '/api/v1/products?filter[sku]=CAM-001').expect(200);
    expect(list.body.items[0].sale_price).toBe('89900.0000');
    expect(list.body.items[0].purchase_price).toBe('52400.0000');
  });

  it('lee los decimales de verdad cuando el fichero los trae', async () => {
    const csv = ['Producto,Referencia,Peso (kg),Precio', 'Tornillo,TOR-001,"0,25","1.250,50"'].join('\n');
    const { body } = await upload('product', csv, 'pesos.csv');
    await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);

    const list = await owner.as('get', '/api/v1/products?filter[sku]=TOR-001').expect(200);
    expect(list.body.items[0].sale_price).toBe('1250.5000');
  });

  it('ejecutar dos veces no duplica: las filas ya hechas no vuelven a correr', async () => {
    const csv = ['Nombre,Documento', 'Repetible,890900608'].join('\n');
    const { body } = await upload('party', csv);
    await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);

    const second = await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);
    expect(second.body.imported).toBe(0);
    expect(second.body.remaining).toBe(0);

    const found = await owner.as('get', '/api/v1/parties?q=Repetible').expect(200);
    expect(found.body.total).toBe(1);
  });

  it('no se puede cambiar el mapeo de una importación ya ejecutada', async () => {
    const csv = ['Nombre,Documento', 'Ya está,890301884'].join('\n');
    const { body } = await upload('party', csv);
    await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);

    const response = await owner
      .as('patch', `/api/v1/imports/${body.job.id}/mapping`)
      .send({ mapping: { displayName: 'Documento' } })
      .expect(422);
    expect(response.body.error.message).toMatch(/ya se ejecutó/);
  });
});

describe('permisos', () => {
  it('importar exige el permiso de crear la entidad', async () => {
    // Sin esto, importar sería un atajo para saltarse quién puede crear qué.
    const seller = await inviteMember(t, owner, { roleCodes: ['SALES'] });
    await seller
      .as('post', '/api/v1/imports')
      .send({ entityType: 'product', filename: 'x.csv', content: 'Producto\nAlgo' })
      .expect(403);

    // Lo suyo sí puede.
    await seller
      .as('post', '/api/v1/imports')
      .send({ entityType: 'party', filename: 'x.csv', content: 'Nombre\nCliente del comercial' })
      .expect(201);
  });
});

describe('historial', () => {
  it('el listado muestra las importaciones con su resultado', async () => {
    const { body } = await owner.as('get', '/api/v1/imports').expect(200);
    expect(body.total).toBeGreaterThan(0);
    const done = body.items.filter((i: { status: string }) => i.status === 'DONE');
    expect(done.length).toBeGreaterThan(0);
    expect(done[0]).toHaveProperty('created_by_name');
  });

  it('borrar el registro no borra lo que se importó', async () => {
    const csv = ['Nombre,Documento', 'Sobrevive,890200106'].join('\n');
    const { body } = await upload('party', csv);
    await owner.as('post', `/api/v1/imports/${body.job.id}/run`).expect(200);
    await owner.as('delete', `/api/v1/imports/${body.job.id}`).expect(204);

    await owner.as('get', `/api/v1/imports/${body.job.id}`).expect(404);
    const found = await owner.as('get', '/api/v1/parties?q=Sobrevive').expect(200);
    expect(found.body.total).toBe(1);
  });
});
