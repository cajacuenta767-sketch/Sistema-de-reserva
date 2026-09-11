import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp, registerOrganization, type TestApp } from '../helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('registro', () => {
  it('crea usuario, empresa, sucursal, roles y sesión completa', async () => {
    const response = await t.api
      .post('/api/v1/auth/register')
      .send({
        email: 'fundadora@test.local',
        password: 'Prueba2026Segura!',
        firstName: 'Ana',
        lastName: 'Restrepo',
        organizationName: 'Distribuidora Andina SAS',
      })
      .expect(201);

    const { session, tokens } = response.body;
    expect(tokens.accessToken).toBeTruthy();
    expect(session.user.email).toBe('fundadora@test.local');
    expect(session.organizations).toHaveLength(1);
    expect(session.organizations[0].tradeName).toBe('Distribuidora Andina SAS');
    expect(session.roles.map((r: { name: string }) => r.name)).toEqual(['Propietario']);

    // El bug que esto vigila: `buildSession` leía los permisos desde una
    // conexión nueva, que no veía los roles de la transacción sin confirmar, y
    // devolvía una sesión recién creada con CERO permisos.
    expect(Object.keys(session.permissions).length).toBeGreaterThan(20);
    expect(session.permissions['identity:role:update']).toBe('ORG');
  });

  it('rechaza un correo repetido', async () => {
    const account = await registerOrganization(t);
    await t.api
      .post('/api/v1/auth/register')
      .send({
        email: account.email,
        password: 'Prueba2026Segura!',
        firstName: 'Otra',
        lastName: 'Persona',
        organizationName: 'Otra',
      })
      .expect(409);
  });

  it('exige una contraseña con mayúscula, minúscula y número', async () => {
    const response = await t.api
      .post('/api/v1/auth/register')
      .send({
        email: 'debil@test.local',
        password: 'todominusculas',
        firstName: 'A',
        lastName: 'B',
        organizationName: 'C',
      })
      .expect(400);
    expect(JSON.stringify(response.body.error.details)).toContain('password');
  });
});

describe('inicio de sesión', () => {
  it('devuelve la sesión con el mismo correo en cualquier caso', async () => {
    const account = await registerOrganization(t);
    const response = await t.api
      .post('/api/v1/auth/login')
      .send({ email: account.email.toUpperCase(), password: 'Prueba2026Segura!' })
      .expect(200);
    expect(response.body.session.user.id).toBe(account.userId);
  });

  it('no distingue correo inexistente de contraseña incorrecta', async () => {
    const account = await registerOrganization(t);

    const wrongPassword = await t.api
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: 'OtraCosa2026!' })
      .expect(401);
    const noSuchUser = await t.api
      .post('/api/v1/auth/login')
      .send({ email: 'noexiste@test.local', password: 'OtraCosa2026!' })
      .expect(401);

    // Mensajes idénticos: distinguirlos permitiría enumerar qué correos tienen
    // cuenta en el sistema.
    expect(wrongPassword.body.error.message).toBe(noSuchUser.body.error.message);
  });

  it('dos sesiones en el mismo segundo no colisionan', async () => {
    const account = await registerOrganization(t);
    const credentials = { email: account.email, password: 'Prueba2026Segura!' };

    // Sin un `jti` único, ambos JWT de refresco serían idénticos (mismo payload
    // y mismo `iat` en segundos) y el segundo choca contra el índice único.
    const first = await t.api.post('/api/v1/auth/login').send(credentials).expect(200);
    const second = await t.api.post('/api/v1/auth/login').send(credentials).expect(200);
    expect(first.body.tokens.refreshToken).not.toBe(second.body.tokens.refreshToken);
  });
});

describe('refresco de sesión', () => {
  it('rota el token y detecta el reuso revocando TODAS las sesiones', async () => {
    const account = await registerOrganization(t);

    const rotated = await t.api
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: account.refreshToken })
      .expect(200);
    const newToken = rotated.body.tokens.refreshToken;

    // Reutilizar el token viejo significa que alguien lo copió.
    await t.api.post('/api/v1/auth/refresh').send({ refreshToken: account.refreshToken }).expect(401);

    // Y el nuevo también debe morir. El bug que esto vigila: la revocación se
    // hacía dentro de la transacción que el propio error revertía, así que
    // detectaba el reuso sin revocar nada.
    await t.api.post('/api/v1/auth/refresh').send({ refreshToken: newToken }).expect(401);
  });

  it('rechaza un token de refresco inventado', async () => {
    await t.api.post('/api/v1/auth/refresh').send({ refreshToken: 'esto.no.es.un.token' }).expect(401);
  });
});

describe('sesión activa', () => {
  it('/auth/session responde a GET y devuelve los permisos', async () => {
    const account = await registerOrganization(t);
    const response = await account.as('get', '/api/v1/auth/session').expect(200);
    expect(response.body.user.id).toBe(account.userId);
    expect(Object.keys(response.body.permissions).length).toBeGreaterThan(20);
  });

  it('sin token, los endpoints privados responden 401', async () => {
    await t.api.get('/api/v1/members').expect(401);
  });

  it('cambiar la contraseña cierra el resto de sesiones', async () => {
    const account = await registerOrganization(t);
    await account
      .as('post', '/api/v1/auth/change-password')
      .send({ currentPassword: 'Prueba2026Segura!', newPassword: 'NuevaClave2026!' })
      .expect(204);

    await t.api.post('/api/v1/auth/refresh').send({ refreshToken: account.refreshToken }).expect(401);
    await t.api
      .post('/api/v1/auth/login')
      .send({ email: account.email, password: 'NuevaClave2026!' })
      .expect(200);
  });
});
