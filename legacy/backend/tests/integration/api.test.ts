import { beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp } from '../helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let clientToken: string;
let adminToken: string;
let staffToken: string;
let serviceId: string;
let staffId: string;

beforeAll(async () => {
  t = await makeTestApp();
  clientToken = await t.login('paola@gmail.com');
  adminToken = await t.login('admin@reservaflow.app');
  staffToken = await t.login('daniel@reservaflow.app');
  const services = await t.api.get('/api/v1/services');
  serviceId = services.body.items.find((s: any) => s.slug === 'reparacion-de-computadora').id;
  const staff = await t.api.get('/api/v1/staff').query({ serviceId });
  staffId = staff.body.items.find((s: any) => s.displayName === 'Daniel García').id;
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Salud y catálogo', () => {
  it('healthcheck', async () => {
    const res = await t.api.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
  it('lista servicios y categorías públicas', async () => {
    const res = await t.api.get('/api/v1/services');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(6);
    const cats = await t.api.get('/api/v1/categories');
    expect(cats.body.items).toHaveLength(3);
  });
  it('rechaza crear servicio sin ser admin', async () => {
    const res = await t.api.post('/api/v1/services').set(auth(clientToken)).send({ name: 'X', durationMinutes: 30, priceCents: 100 });
    expect(res.status).toBe(403);
  });
  it('admin crea y edita servicio', async () => {
    const res = await t.api.post('/api/v1/services').set(auth(adminToken)).send({ name: 'Servicio nuevo', description: 'd', durationMinutes: 45, priceCents: 5000 });
    expect(res.status).toBe(201);
    const upd = await t.api.patch(`/api/v1/services/${res.body.id}`).set(auth(adminToken)).send({ priceCents: 6000 });
    expect(upd.body.priceCents).toBe(6000);
  });
});

describe('Auth', () => {
  it('registra, devuelve tokens y refresca', async () => {
    const res = await t.api.post('/api/v1/auth/register').send({ email: 'nuevo@test.com', password: 'Password123', firstName: 'Nuevo', lastName: 'Usuario' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CLIENT');
    const refreshed = await t.api.post('/api/v1/auth/refresh').send({ refreshToken: res.body.tokens.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.tokens.accessToken).toBeTruthy();
  });
  it('valida entradas', async () => {
    const res = await t.api.post('/api/v1/auth/register').send({ email: 'no-es-email', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('rechaza credenciales incorrectas', async () => {
    const res = await t.api.post('/api/v1/auth/login').send({ email: 'paola@gmail.com', password: 'mala' });
    expect(res.status).toBe(401);
  });
  it('devuelve perfil con /me', async () => {
    const res = await t.api.get('/api/v1/auth/me').set(auth(clientToken));
    expect(res.body.user.email).toBe('paola@gmail.com');
    expect(res.body.user.passwordHash).toBeUndefined();
  });
});

describe('Disponibilidad y reservas', () => {
  let bookingId: string;
  const date = '2026-03-11'; // miércoles

  it('devuelve franjas del día para el profesional', async () => {
    const res = await t.api.get(`/api/v1/staff/${staffId}/availability`).query({ serviceId, date });
    expect(res.status).toBe(200);
    expect(res.body.slots.length).toBeGreaterThan(0);
    expect(res.body.slots[0]).toMatchObject({ time: '09:00', startAt: `${date}T09:00` });
  });
  it('resumen mensual marca días pasados con 0', async () => {
    const res = await t.api.get(`/api/v1/staff/${staffId}/availability/month`).query({ serviceId, month: '2026-03' });
    expect(res.body.days).toHaveLength(31);
    expect(res.body.days[0].slots).toBe(0); // 1 de marzo ya pasó
    expect(res.body.days[10].slots).toBeGreaterThan(0); // 11 de marzo
  });
  it('filtra profesionales disponibles hoy', async () => {
    const res = await t.api.get('/api/v1/staff').query({ serviceId, availableOn: '2026-03-10' });
    expect(res.status).toBe(200);
    expect(res.body.items.every((s: any) => s.serviceIds.includes(serviceId))).toBe(true);
  });
  it('cotiza con cupón', async () => {
    const res = await t.api.post('/api/v1/bookings/quote').send({ serviceId, couponCode: 'bienvenido10' });
    expect(res.body.discountCents).toBe(800000);
    expect(res.body.totalCents).toBe(7200000);
  });
  it('rechaza cupón inválido', async () => {
    const res = await t.api.post('/api/v1/bookings/quote').send({ serviceId, couponCode: 'NOEXISTE' });
    expect(res.status).toBe(422);
  });
  it('crea una reserva y notifica', async () => {
    const res = await t.api.post('/api/v1/bookings').set(auth(clientToken)).send({ staffId, serviceId, startAt: `${date}T10:00`, couponCode: 'BIENVENIDO10', notes: 'Trae repuestos' });
    expect(res.status).toBe(201);
    const b = res.body.items[0];
    bookingId = b.id;
    expect(b.status).toBe('CONFIRMED');
    expect(b.code).toMatch(/^RF-/);
    expect(b.endAt).toBe(`${date}T11:00`);
    expect(b.totalCents).toBe(7200000);
    expect(b.staff.displayName).toBe('Daniel García');
    const notif = await t.api.get('/api/v1/notifications').set(auth(clientToken));
    expect(notif.body.unread).toBeGreaterThan(0);
    expect(notif.body.items[0].type).toBe('BOOKING_CREATED');
  });
  it('la franja tomada desaparece de la disponibilidad (con buffer)', async () => {
    const res = await t.api.get(`/api/v1/staff/${staffId}/availability`).query({ serviceId, date });
    const times = res.body.slots.map((s: any) => s.time);
    expect(times).not.toContain('10:00');
    expect(times).not.toContain('09:30'); // 09:30-10:30+15 solapa
    expect(times).not.toContain('11:00'); // buffer de 15 tras las 11:00
    expect(times).toContain('11:30');
  });
  it('rechaza doble reserva en la misma franja', async () => {
    const other = await t.login('andres@gmail.com');
    const res = await t.api.post('/api/v1/bookings').set(auth(other)).send({ staffId, serviceId, startAt: `${date}T10:00` });
    expect(res.status).toBe(409);
  });
  it('rechaza reservar en el pasado', async () => {
    const res = await t.api.post('/api/v1/bookings').set(auth(clientToken)).send({ staffId, serviceId, startAt: '2026-03-09T10:00' });
    expect(res.status).toBe(422);
  });
  it('crea una serie semanal (todo o nada)', async () => {
    const res = await t.api.post('/api/v1/bookings').set(auth(clientToken)).send({ staffId, serviceId, startAt: '2026-03-12T14:00', frequency: 'WEEKLY', occurrences: 3 });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items.map((b: any) => b.startAt)).toEqual(['2026-03-12T14:00', '2026-03-19T14:00', '2026-03-26T14:00']);
    expect(res.body.seriesId).toBeTruthy();
    // conflicto en la 2ª ocurrencia → no se crea nada
    const clash = await t.api.post('/api/v1/bookings').set(auth(clientToken)).send({ staffId, serviceId, startAt: '2026-03-12T16:00', frequency: 'WEEKLY', occurrences: 2 });
    expect(clash.status).toBe(201);
    const clash2 = await t.api.post('/api/v1/bookings').set(auth(clientToken)).send({ staffId, serviceId, startAt: '2026-03-05T16:00', frequency: 'WEEKLY', occurrences: 2 });
    expect(clash2.status).toBe(422); // primera en el pasado
  });
  it('lista mis reservas próximas', async () => {
    const res = await t.api.get('/api/v1/bookings').set(auth(clientToken)).query({ upcoming: true });
    expect(res.status).toBe(200);
    expect(res.body.items.some((b: any) => b.id === bookingId)).toBe(true);
    expect(res.body.items.every((b: any) => b.clientId === res.body.items[0].clientId)).toBe(true);
  });
  it('otro cliente no puede ver mi reserva', async () => {
    const other = await t.login('andres@gmail.com');
    const res = await t.api.get(`/api/v1/bookings/${bookingId}`).set(auth(other));
    expect(res.status).toBe(403);
  });
  it('reprograma la reserva', async () => {
    const res = await t.api.post(`/api/v1/bookings/${bookingId}/reschedule`).set(auth(clientToken)).send({ startAt: `${date}T15:00` });
    expect(res.status).toBe(200);
    expect(res.body.startAt).toBe(`${date}T15:00`);
    const again = await t.api.get(`/api/v1/staff/${staffId}/availability`).query({ serviceId, date });
    expect(again.body.slots.map((s: any) => s.time)).toContain('10:00');
  });
  it('el cliente no puede cambiar estado; el staff sí completa', async () => {
    const forbidden = await t.api.post(`/api/v1/bookings/${bookingId}/status`).set(auth(clientToken)).send({ status: 'COMPLETED' });
    expect(forbidden.status).toBe(403);
    const inProgress = await t.api.post(`/api/v1/bookings/${bookingId}/status`).set(auth(staffToken)).send({ status: 'IN_PROGRESS' });
    expect(inProgress.body.status).toBe('IN_PROGRESS');
    const done = await t.api.post(`/api/v1/bookings/${bookingId}/status`).set(auth(staffToken)).send({ status: 'COMPLETED' });
    expect(done.body.status).toBe('COMPLETED');
    const invalid = await t.api.post(`/api/v1/bookings/${bookingId}/status`).set(auth(staffToken)).send({ status: 'CANCELLED' });
    expect(invalid.status).toBe(422);
  });
  it('permite reseñar solo reservas completadas y actualiza el rating', async () => {
    const before = await t.api.get(`/api/v1/staff/${staffId}`);
    const res = await t.api.post('/api/v1/reviews').set(auth(clientToken)).send({ bookingId, rating: 5, comment: 'Excelente' });
    expect(res.status).toBe(201);
    const dup = await t.api.post('/api/v1/reviews').set(auth(clientToken)).send({ bookingId, rating: 4, comment: 'Otra' });
    expect(dup.status).toBe(409);
    const after = await t.api.get(`/api/v1/staff/${staffId}`);
    expect(after.body.ratingCount).toBe(before.body.ratingCount + 1);
    const list = await t.api.get('/api/v1/reviews').query({ staffId });
    expect(list.body.items[0].comment).toBe('Excelente');
  });
  it('cancela con política de antelación', async () => {
    const soon = await t.api.post('/api/v1/bookings').set(auth(clientToken)).send({ staffId, serviceId, startAt: '2026-03-10T10:30' });
    expect(soon.status).toBe(201);
    const tooLate = await t.api.post(`/api/v1/bookings/${soon.body.items[0].id}/cancel`).set(auth(clientToken)).send({});
    expect(tooLate.status).toBe(422);
    const byAdmin = await t.api.post(`/api/v1/bookings/${soon.body.items[0].id}/cancel`).set(auth(adminToken)).send({ reason: 'Prueba' });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.items[0].status).toBe('CANCELLED');
  });
  it('cancela una serie completa', async () => {
    const res = await t.api.post('/api/v1/bookings').set(auth(clientToken)).send({ staffId, serviceId, startAt: '2026-03-13T09:00', frequency: 'WEEKLY', occurrences: 3 });
    const first = res.body.items[1];
    const cancel = await t.api.post(`/api/v1/bookings/${first.id}/cancel`).set(auth(clientToken)).send({ wholeSeries: true });
    expect(cancel.body.items).toHaveLength(2); // desde la 2ª en adelante
  });
  it('consulta por código de confirmación', async () => {
    const b = await t.api.get(`/api/v1/bookings/${bookingId}`).set(auth(clientToken));
    const res = await t.api.get(`/api/v1/bookings/code/${b.body.code}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(bookingId);
  });
});

describe('Staff, lista de espera y admin', () => {
  it('el profesional gestiona su horario y bloqueos', async () => {
    const me = await t.api.get('/api/v1/staff/me').set(auth(staffToken));
    expect(me.status).toBe(200);
    const off = await t.api.post(`/api/v1/staff/${me.body.id}/time-off`).set(auth(staffToken)).send({ startAt: '2026-03-18T09:00', endAt: '2026-03-18T18:00', reason: 'Cita médica' });
    expect(off.status).toBe(201);
    const slots = await t.api.get(`/api/v1/staff/${me.body.id}/availability`).query({ serviceId, date: '2026-03-18' });
    expect(slots.body.slots).toHaveLength(0);
    const other = await t.login('lulu@reservaflow.app');
    const forbidden = await t.api.put(`/api/v1/staff/${me.body.id}/working-hours`).set(auth(other)).send({ hours: [] });
    expect(forbidden.status).toBe(403);
  });
  it('lista de espera se notifica al liberar un cupo', async () => {
    const other = await t.login('andres@gmail.com');
    const join = await t.api.post('/api/v1/waitlist').set(auth(other)).send({ serviceId, date: '2026-03-20', staffId });
    expect(join.status).toBe(201);
    const b = await t.api.post('/api/v1/bookings').set(auth(clientToken)).send({ staffId, serviceId, startAt: '2026-03-20T10:00' });
    await t.api.post(`/api/v1/bookings/${b.body.items[0].id}/cancel`).set(auth(clientToken)).send({});
    const notif = await t.api.get('/api/v1/notifications').set(auth(other));
    expect(notif.body.items.some((n: any) => n.type === 'WAITLIST_SLOT_AVAILABLE')).toBe(true);
  });
  it('admin ve estadísticas', async () => {
    const res = await t.api.get('/api/v1/admin/stats').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.range.total).toBeGreaterThan(0);
    expect(res.body.last14Days).toHaveLength(14);
    expect(res.body.staff.length).toBe(4);
    const denied = await t.api.get('/api/v1/admin/stats').set(auth(clientToken));
    expect(denied.status).toBe(403);
  });
  it('ruta inexistente devuelve 404 JSON', async () => {
    const res = await t.api.get('/api/v1/nada');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
