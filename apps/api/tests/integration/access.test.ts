import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, registerOrganization, inviteMember, type Account, type TestApp } from '../helpers.js';

/**
 * Gestión de accesos: roles, alcances, excepciones y equipos.
 *
 * Lo que se prueba aquí no es CRUD, sino las reglas que impiden que la
 * organización se quede sin quien la administre.
 */

let t: TestApp;
let owner: Account;

beforeAll(async () => {
  t = await makeTestApp();
  owner = await registerOrganization(t, { organizationName: 'Andina' });
});
afterAll(async () => {
  await t.close();
});

const roleIdByCode = async (code: string): Promise<string> => {
  const roles = await owner.as('get', '/api/v1/roles').expect(200);
  return roles.body.items.find((r: { code: string }) => r.code === code).id;
};

describe('roles del sistema', () => {
  it('se crean cinco a partir de las plantillas', async () => {
    const response = await owner.as('get', '/api/v1/roles').expect(200);
    expect(response.body.items.map((r: { code: string }) => r.code).sort()).toEqual([
      'ACCOUNTANT',
      'ADMIN',
      'EMPLOYEE',
      'OWNER',
      'SALES',
    ]);
    expect(response.body.items.every((r: { isSystem: boolean }) => r.isSystem)).toBe(true);
  });

  it('no se pueden renombrar ni eliminar', async () => {
    const ownerRole = await roleIdByCode('OWNER');
    await owner.as('patch', `/api/v1/roles/${ownerRole}`).send({ name: 'Otro nombre' }).expect(422);
    await owner.as('delete', `/api/v1/roles/${ownerRole}`).expect(422);
  });

  it('sus permisos sí se pueden editar', async () => {
    const salesRole = await roleIdByCode('SALES');
    await owner
      .as('put', `/api/v1/roles/${salesRole}/permissions`)
      .send({ permissions: [{ key: 'identity:member:read', scope: 'TEAM' }] })
      .expect(204);

    const after = await owner.as('get', `/api/v1/roles/${salesRole}`).expect(200);
    expect(after.body.permissions).toEqual([{ key: 'identity:member:read', scope: 'TEAM' }]);
  });

  it('rechaza conceder un permiso que no existe', async () => {
    const salesRole = await roleIdByCode('SALES');
    const response = await owner
      .as('put', `/api/v1/roles/${salesRole}/permissions`)
      .send({ permissions: [{ key: 'ventas:factura:inventada', scope: 'ORG' }] })
      .expect(400);
    // Un permiso huérfano en un rol es una mentira sobre lo que alguien puede
    // hacer: se rechaza al escribirlo, no al comprobarlo.
    expect(response.body.error.details.unknown).toContain('ventas:factura:inventada');
  });
});

describe('roles propios', () => {
  it('se crean, se editan y se eliminan', async () => {
    const created = await owner
      .as('post', '/api/v1/roles')
      .send({ name: 'Auditor externo', description: 'Solo lectura' })
      .expect(201);

    await owner.as('patch', `/api/v1/roles/${created.body.id}`).send({ name: 'Auditoría' }).expect(200);
    await owner.as('delete', `/api/v1/roles/${created.body.id}`).expect(204);
    await owner.as('get', `/api/v1/roles/${created.body.id}`).expect(404);
  });

  it('no admite dos roles con el mismo nombre', async () => {
    await owner.as('post', '/api/v1/roles').send({ name: 'Repetido' }).expect(201);
    await owner.as('post', '/api/v1/roles').send({ name: 'Repetido' }).expect(409);
  });
});

describe('asignación de roles', () => {
  it('los permisos del usuario cambian al cambiarle el rol', async () => {
    const member = await inviteMember(t, owner, { roleCodes: [] });

    await member.as('get', '/api/v1/members').expect(403);

    await owner
      .as('put', `/api/v1/members/${member.membershipId}/roles`)
      .send({ roleIds: [await roleIdByCode('ADMIN')] })
      .expect(204);

    // El token sigue siendo el mismo: los permisos se resuelven en cada
    // petición, no se congelan al iniciar sesión. Cambiar un rol surte efecto
    // sin obligar a nadie a volver a entrar.
    await member.as('get', '/api/v1/members').expect(200);
  });

  it('el propietario no puede quedarse sin roles', async () => {
    await owner.as('put', `/api/v1/members/${owner.membershipId}/roles`).send({ roleIds: [] }).expect(422);
  });

  it('el propietario no puede ser suspendido', async () => {
    await owner
      .as('patch', `/api/v1/members/${owner.membershipId}/status`)
      .send({ status: 'SUSPENDED' })
      .expect(422);
  });

  it('nadie puede cambiar su propio estado', async () => {
    const admin = await inviteMember(t, owner, { roleCodes: ['ADMIN'] });
    await admin
      .as('patch', `/api/v1/members/${admin.membershipId}/status`)
      .send({ status: 'SUSPENDED' })
      .expect(422);
  });

  it('una persona suspendida pierde el acceso', async () => {
    const member = await inviteMember(t, owner, { roleCodes: ['ADMIN'] });
    await member.as('get', '/api/v1/members').expect(200);

    await owner
      .as('patch', `/api/v1/members/${member.membershipId}/status`)
      .send({ status: 'SUSPENDED' })
      .expect(204);

    await member.as('get', '/api/v1/members').expect(403);
  });
});

describe('excepciones de permisos', () => {
  it('un DENY puntual gana sobre el rol', async () => {
    const admin = await inviteMember(t, owner, { roleCodes: ['ADMIN'] });
    await admin.as('get', '/api/v1/audit').expect(200);

    await owner
      .as('put', `/api/v1/members/${admin.membershipId}/permissions/identity:audit:read`)
      .send({ effect: 'DENY', reason: 'En periodo de prueba' })
      .expect(204);

    await admin.as('get', '/api/v1/audit').expect(403);

    await owner
      .as('delete', `/api/v1/members/${admin.membershipId}/permissions/identity:audit:read`)
      .expect(204);
    await admin.as('get', '/api/v1/audit').expect(200);
  });

  it('un ALLOW puntual concede lo que ningún rol otorga', async () => {
    const member = await inviteMember(t, owner, { roleCodes: ['EMPLOYEE'] });
    await member.as('get', '/api/v1/members').expect(403);

    await owner
      .as('put', `/api/v1/members/${member.membershipId}/permissions/identity:member:read`)
      .send({ effect: 'ALLOW', scope: 'ORG' })
      .expect(204);

    await member.as('get', '/api/v1/members').expect(200);
  });
});

describe('invitaciones', () => {
  it('no se puede invitar a quien ya pertenece a la empresa', async () => {
    const member = await inviteMember(t, owner, { roleCodes: ['EMPLOYEE'] });
    await owner.as('post', '/api/v1/invitations').send({ email: member.email, roleIds: [] }).expect(409);
  });

  it('una invitación revocada ya no sirve', async () => {
    const invitation = await owner
      .as('post', '/api/v1/invitations')
      .send({ email: 'revocado@test.local', roleIds: [] })
      .expect(201);

    await owner.as('delete', `/api/v1/invitations/${invitation.body.id}`).expect(204);

    await t.api
      .post('/api/v1/auth/register')
      .send({
        email: 'revocado@test.local',
        password: 'Prueba2026Segura!',
        firstName: 'No',
        lastName: 'Entra',
        invitationToken: invitation.body.token,
      })
      .expect(400);
  });

  it('una invitación es para el correo al que se envió', async () => {
    const invitation = await owner
      .as('post', '/api/v1/invitations')
      .send({ email: 'destinataria@test.local', roleIds: [] })
      .expect(201);

    await t.api
      .post('/api/v1/auth/register')
      .send({
        email: 'otra.persona@test.local',
        password: 'Prueba2026Segura!',
        firstName: 'Otra',
        lastName: 'Persona',
        invitationToken: invitation.body.token,
      })
      .expect(403);
  });
});

describe('auditoría', () => {
  it('registra qué campos cambiaron, no solo que hubo un cambio', async () => {
    await owner
      .as('patch', '/api/v1/organization')
      .send({ city: 'Bogotá', phone: '+57 1 234 5678' })
      .expect(200);

    const audit = await owner.as('get', '/api/v1/audit?filter[entity_type]=organization').expect(200);
    const entry = audit.body.items[0];
    expect(entry.action).toBe('UPDATE');
    expect(entry.changed_fields).toEqual(expect.arrayContaining(['city', 'phone']));
    expect(entry.before.city).not.toBe('Bogotá');
    expect(entry.after.city).toBe('Bogotá');
  });

  it('no registra un cambio que no cambia nada', async () => {
    const before = await owner.as('get', '/api/v1/audit?filter[entity_type]=organization').expect(200);
    const organization = await owner.as('get', '/api/v1/organization').expect(200);

    await owner.as('patch', '/api/v1/organization').send({ city: organization.body.city }).expect(200);

    const after = await owner.as('get', '/api/v1/audit?filter[entity_type]=organization').expect(200);
    expect(after.body.total).toBe(before.body.total);
  });

  it('no se puede editar ni borrar', async () => {
    await t.container.pool.query('SELECT 1');
    const client = await t.container.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', owner.organizationId]);
      const before = await client.query('SELECT count(*)::int AS total FROM audit_logs');
      // Las reglas de la tabla convierten UPDATE y DELETE en nada: una
      // auditoría que se puede editar no es una auditoría.
      await client.query("UPDATE audit_logs SET action = 'CREATE'");
      await client.query('DELETE FROM audit_logs');
      const after = await client.query('SELECT count(*)::int AS total FROM audit_logs');
      expect(after.rows[0].total).toBe(before.rows[0].total);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});

describe('validación del NIT colombiano', () => {
  it('calcula el dígito de verificación y rechaza uno incorrecto', async () => {
    const ok = await owner.as('patch', '/api/v1/organization').send({ taxId: '900123456' }).expect(200);
    expect(ok.body.taxIdDv).toBe('8');

    const bad = await owner
      .as('patch', '/api/v1/organization')
      .send({ taxId: '900123456', taxIdDv: '3' })
      .expect(400);
    expect(bad.body.error.message).toContain('debería ser 8');
  });
});
