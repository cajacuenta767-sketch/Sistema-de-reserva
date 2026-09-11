import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asTenant, makeTestApp, registerOrganization, inviteMember, type Account, type TestApp } from '../helpers.js';

let t: TestApp;
let owner: Account;

beforeAll(async () => {
  t = await makeTestApp();
  owner = await registerOrganization(t, { organizationName: 'Distribuidora Andina' });
});
afterAll(async () => {
  await t.close();
});

describe('crear partes', () => {
  it('crea un cliente y calcula el dígito de verificación del NIT', async () => {
    const response = await owner
      .as('post', '/api/v1/parties')
      .send({
        displayName: 'Supermercados La 14',
        legalName: 'Supermercados La 14 S.A.',
        taxIdType: 'NIT',
        taxId: '890.903.938',
        email: 'compras@la14.co',
      })
      .expect(201);

    expect(response.body.taxId).toBe('890903938'); // normalizado, sin puntos
    expect(response.body.taxIdDv).toBe('8');
    expect(response.body.isCustomer).toBe(true);
    expect(response.body.isVendor).toBe(false);
  });

  it('rechaza un dígito de verificación que no corresponde', async () => {
    const response = await owner
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Mal NIT', taxId: '900123456', taxIdDv: '3' })
      .expect(400);
    expect(response.body.error.message).toContain('debería ser 8');
  });

  it('no admite dos partes con el mismo documento', async () => {
    await owner.as('post', '/api/v1/parties').send({ displayName: 'Uno', taxId: '811021438' }).expect(201);
    const response = await owner
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Otro', taxId: '811.021.438' })
      .expect(409);
    // El mensaje nombra a quién ya lo tiene: buscar el duplicado a mano es el
    // primer paso que da cualquiera al ver este error.
    expect(response.body.error.message).toContain('Uno');
  });

  it('una persona natural con cédula no lleva dígito de verificación', async () => {
    const response = await owner
      .as('post', '/api/v1/parties')
      .send({ kind: 'PERSON', displayName: 'Juan Pérez', taxIdType: 'CC', taxId: '1020304050' })
      .expect(201);
    expect(response.body.taxIdDv).toBeNull();
  });

  it('acepta un consumidor final sin documento', async () => {
    await owner
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Consumidor final', taxIdType: 'SIN_IDENTIFICAR', taxId: null })
      .expect(201);
  });

  it('crea el perfil de cliente con sus condiciones comerciales', async () => {
    const created = await owner
      .as('post', '/api/v1/parties')
      .send({
        displayName: 'Con perfil',
        taxId: '899999068',
        customerProfile: { paymentTermsDays: 30, creditLimit: '5000000', defaultCurrency: 'COP' },
      })
      .expect(201);

    const detail = await owner.as('get', `/api/v1/parties/${created.body.id}`).expect(200);
    expect(detail.body.customerProfile.paymentTermsDays).toBe(30);
    expect(detail.body.customerProfile.creditLimit).toBe('5000000.0000');
    expect(detail.body.vendorProfile).toBeNull();
  });
});

describe('cliente y proveedor a la vez', () => {
  it('una misma parte puede ser las dos cosas, con un perfil de cada', async () => {
    const created = await owner
      .as('post', '/api/v1/parties')
      .send({
        displayName: 'Papelería Universal',
        taxId: '890900608',
        isCustomer: true,
        isVendor: true,
        customerProfile: { paymentTermsDays: 15 },
        vendorProfile: { paymentTermsDays: 45, leadTimeDays: 3 },
      })
      .expect(201);

    const detail = await owner.as('get', `/api/v1/parties/${created.body.id}`).expect(200);
    // Ésta es la razón de tener UNA tabla de partes: la misma empresa, un solo
    // NIT, una sola dirección, dos roles.
    expect(detail.body.customerProfile.paymentTermsDays).toBe(15);
    expect(detail.body.vendorProfile.paymentTermsDays).toBe(45);
    expect(detail.body.vendorProfile.leadTimeDays).toBe(3);
  });

  it('quitarle el rol de proveedor borra su perfil de proveedor', async () => {
    const created = await owner
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Deja de ser proveedor', isCustomer: true, isVendor: true })
      .expect(201);

    await owner.as('patch', `/api/v1/parties/${created.body.id}`).send({ isVendor: false }).expect(200);

    const detail = await owner.as('get', `/api/v1/parties/${created.body.id}`).expect(200);
    // Conservarlo dejaría condiciones de pago de alguien que ya no es proveedor.
    expect(detail.body.vendorProfile).toBeNull();
    expect(detail.body.customerProfile).not.toBeNull();
  });
});

describe('direcciones', () => {
  it('la primera dirección es la principal aunque no se pida', async () => {
    const party = await owner.as('post', '/api/v1/parties').send({ displayName: 'Con dirección' }).expect(201);

    const address = await owner
      .as('post', `/api/v1/parties/${party.body.id}/addresses`)
      .send({ line1: 'Calle 10 # 5-20', city: 'Medellín', isDefault: false })
      .expect(201);
    expect(address.body.isDefault).toBe(true);

    const second = await owner
      .as('post', `/api/v1/parties/${party.body.id}/addresses`)
      .send({ kind: 'SHIPPING', line1: 'Carrera 43 # 1-50', city: 'Envigado', isDefault: true })
      .expect(201);
    expect(second.body.isDefault).toBe(true);

    const detail = await owner.as('get', `/api/v1/parties/${party.body.id}`).expect(200);
    // Solo una principal: dos romperían la selección automática al facturar.
    expect(detail.body.addresses.filter((a: { isDefault: boolean }) => a.isDefault)).toHaveLength(1);
  });

  it('la ciudad de la dirección principal aparece en el listado', async () => {
    const list = await owner.as('get', '/api/v1/parties?q=Con dirección').expect(200);
    expect(list.body.items[0].city).toBe('Envigado');
  });
});

describe('contactos', () => {
  it('solo puede haber un contacto principal por parte', async () => {
    const party = await owner.as('post', '/api/v1/parties').send({ displayName: 'Con contactos' }).expect(201);

    await owner
      .as('post', '/api/v1/contacts')
      .send({ partyId: party.body.id, firstName: 'Ana', lastName: 'Gómez', isPrimary: true })
      .expect(201);
    await owner
      .as('post', '/api/v1/contacts')
      .send({ partyId: party.body.id, firstName: 'Luis', lastName: 'Pérez', isPrimary: true })
      .expect(201);

    const detail = await owner.as('get', `/api/v1/parties/${party.body.id}`).expect(200);
    const primary = detail.body.contacts.filter((c: { isPrimary: boolean }) => c.isPrimary);
    expect(primary).toHaveLength(1);
    expect(primary[0].firstName).toBe('Luis');
  });
});

describe('etiquetas', () => {
  it('se crean, se asignan y se pueden filtrar', async () => {
    const tag = await owner.as('post', '/api/v1/tags').send({ name: 'Preferente', colorHue: 150 }).expect(201);

    const party = await owner
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Cliente preferente', tagIds: [tag.body.id] })
      .expect(201);

    const detail = await owner.as('get', `/api/v1/parties/${party.body.id}`).expect(200);
    expect(detail.body.tags.map((x: { name: string }) => x.name)).toEqual(['Preferente']);

    const filtered = await owner.as('get', `/api/v1/parties?filter[tag]=${tag.body.id}`).expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].display_name).toBe('Cliente preferente');
  });

  it('no admite dos etiquetas con el mismo nombre', async () => {
    await owner.as('post', '/api/v1/tags').send({ name: 'Repetida' }).expect(201);
    await owner.as('post', '/api/v1/tags').send({ name: 'Repetida' }).expect(409);
  });

  it('borrar una etiqueta la quita de las fichas', async () => {
    const tag = await owner.as('post', '/api/v1/tags').send({ name: 'Temporal' }).expect(201);
    const party = await owner
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Con etiqueta temporal', tagIds: [tag.body.id] })
      .expect(201);

    await owner.as('delete', `/api/v1/tags/${tag.body.id}`).expect(204);

    const detail = await owner.as('get', `/api/v1/parties/${party.body.id}`).expect(200);
    expect(detail.body.tags).toEqual([]);
  });
});

describe('alcance de permisos', () => {
  it('con alcance OWN solo se ven las partes propias', async () => {
    const seller = await inviteMember(t, owner, { roleCodes: ['SALES'], email: 'comercial@test.local' });

    // El rol Comercial tiene `crm:party:*` con alcance OWN.
    const own = await seller
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Cliente del comercial' })
      .expect(201);

    const visible = await seller.as('get', '/api/v1/parties').expect(200);
    const names = visible.body.items.map((p: { display_name: string }) => p.display_name);
    expect(names).toContain('Cliente del comercial');
    // Las que creó la propietaria no son suyas.
    expect(names).not.toContain('Supermercados La 14');

    // Y la propietaria, con alcance ORG, sí las ve todas.
    const all = await owner.as('get', '/api/v1/parties').expect(200);
    expect(all.body.total).toBeGreaterThan(visible.body.total);

    // Abrir una ficha ajena por su id tampoco cuela.
    const someoneElses = all.body.items.find(
      (p: { id: string; display_name: string }) => p.display_name === 'Supermercados La 14',
    );
    await seller.as('get', `/api/v1/parties/${someoneElses.id}`).expect(403);
    await seller.as('get', `/api/v1/parties/${own.body.id}`).expect(200);
  });
});

describe('vista general', () => {
  it('cuenta clientes, proveedores y contactos', async () => {
    const overview = await owner.as('get', '/api/v1/parties/overview').expect(200);
    expect(overview.body.total).toBeGreaterThan(5);
    expect(overview.body.customers).toBeGreaterThan(0);
    expect(overview.body.vendors).toBeGreaterThan(0);
    expect(overview.body.contacts).toBeGreaterThan(0);
  });
});

describe('actividades', () => {
  it('una nota nace completada y una tarea con vencimiento, pendiente', async () => {
    const party = await owner.as('post', '/api/v1/parties').send({ displayName: 'Con actividad' }).expect(201);

    const note = await owner
      .as('post', '/api/v1/activities')
      .send({ kind: 'NOTE', entityType: 'party', entityId: party.body.id, subject: 'Llamó preguntando precios' })
      .expect(201);
    expect(note.body.completedAt).not.toBeNull();

    const task = await owner
      .as('post', '/api/v1/activities')
      .send({
        kind: 'CALL',
        entityType: 'party',
        entityId: party.body.id,
        subject: 'Llamar para cotizar',
        dueAt: '2026-04-01T14:00:00.000Z',
      })
      .expect(201);
    expect(task.body.completedAt).toBeNull();

    await owner.as('post', `/api/v1/activities/${task.body.id}/complete`).expect(200);
    const activities = await owner
      .as('get', `/api/v1/activities?entityType=party&entityId=${party.body.id}`)
      .expect(200);
    expect(activities.body.items.every((a: { completedAt: string | null }) => a.completedAt)).toBe(true);
  });
});

describe('borrado', () => {
  it('es lógico: la parte desaparece del listado pero no de la base', async () => {
    const party = await owner.as('post', '/api/v1/parties').send({ displayName: 'A borrar' }).expect(201);
    await owner.as('delete', `/api/v1/parties/${party.body.id}`).expect(204);

    await owner.as('get', `/api/v1/parties/${party.body.id}`).expect(404);
    const list = await owner.as('get', '/api/v1/parties?q=A borrar').expect(200);
    expect(list.body.total).toBe(0);

    // Sigue en la base: una parte referenciada por facturas no puede
    // desaparecer sin dejar documentos huérfanos. La consulta va dentro del
    // tenant porque RLS está forzada; a pelo no vería la fila aunque exista.
    const rows = await asTenant(t, owner, async (client) => {
      const result = await client.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM parties WHERE id = $1',
        [party.body.id],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).toBeInstanceOf(Date);
  });

  it('el documento liberado se puede reutilizar', async () => {
    const first = await owner
      .as('post', '/api/v1/parties')
      .send({ displayName: 'Primera', taxId: '860002964' })
      .expect(201);
    await owner.as('delete', `/api/v1/parties/${first.body.id}`).expect(204);

    // El índice único es parcial sobre `deleted_at IS NULL`: tras el borrado
    // lógico, el NIT vuelve a estar disponible.
    await owner.as('post', '/api/v1/parties').send({ displayName: 'Segunda', taxId: '860002964' }).expect(201);
  });
});
