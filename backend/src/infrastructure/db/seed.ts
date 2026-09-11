/**
 * Datos de demostración. Ejecutar: `npm run seed -w backend`
 * Es idempotente: si ya existe el admin, no vuelve a sembrar.
 */
import { loadEnv } from '../../config/env.js';
import { buildContainer } from '../container.js';
import { addDays, toLocalDate } from '../../shared/dates.js';
import { logger } from '../../shared/logger.js';

export const DEMO_PASSWORD = 'Reserva123!';

export const seedDatabase = async (container: ReturnType<typeof buildContainer>) => {
  const { useCases, repos, clock } = container;
  if (await repos.users.findByEmail('admin@reservaflow.app')) {
    logger.info('La base de datos ya tiene datos de demostración; no se vuelve a sembrar.');
    return;
  }

  // --- Admin y clientes ---
  const admin = await useCases.auth.register({ email: 'admin@reservaflow.app', password: DEMO_PASSWORD, firstName: 'Ana', lastName: 'Administradora', role: 'ADMIN' });
  const paola = await useCases.auth.register({ email: 'paola@gmail.com', password: DEMO_PASSWORD, firstName: 'Paola', lastName: 'López', phone: '+57 321 232 3322' });
  await useCases.auth.updateProfile(paola.user.id, { address: 'Calle 80 # 63-21', city: 'Medellín' });
  const andres = await useCases.auth.register({ email: 'andres@gmail.com', password: DEMO_PASSWORD, firstName: 'Andrés', lastName: 'Rojas', phone: '+57 300 111 2233' });

  // --- Categorías y servicios ---
  const tech = await useCases.catalog.createCategory({ name: 'Tecnología', icon: 'laptop', sortOrder: 1 });
  const home = await useCases.catalog.createCategory({ name: 'Hogar', icon: 'home', sortOrder: 2 });
  const wellness = await useCases.catalog.createCategory({ name: 'Bienestar', icon: 'sparkles', sortOrder: 3 });

  const svc = {
    pc: await useCases.catalog.createService({ categoryId: tech.id, name: 'Reparación de computadora', description: 'Diagnóstico completo, limpieza interna, optimización del sistema y reparación de hardware o software.', durationMinutes: 60, bufferMinutes: 15, priceCents: 8000000, isFeatured: true, imageUrl: 'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?w=800&q=80' }),
    net: await useCases.catalog.createService({ categoryId: tech.id, name: 'Instalación de red Wi-Fi', description: 'Configuración de router, repetidores y optimización de cobertura en toda la casa u oficina.', durationMinutes: 90, bufferMinutes: 15, priceCents: 12000000, imageUrl: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=800&q=80' }),
    clean: await useCases.catalog.createService({ categoryId: home.id, name: 'Limpieza profunda del hogar', description: 'Limpieza integral de todas las áreas: cocina, baños, habitaciones y zonas comunes.', durationMinutes: 120, bufferMinutes: 30, priceCents: 15000000, isFeatured: true, imageUrl: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&q=80' }),
    plumb: await useCases.catalog.createService({ categoryId: home.id, name: 'Plomería a domicilio', description: 'Reparación de fugas, grifería, sanitarios y destape de tuberías.', durationMinutes: 60, bufferMinutes: 15, priceCents: 9000000, imageUrl: 'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=800&q=80' }),
    massage: await useCases.catalog.createService({ categoryId: wellness.id, name: 'Masaje relajante', description: 'Sesión de masaje terapéutico para aliviar tensión muscular y estrés.', durationMinutes: 60, bufferMinutes: 15, priceCents: 11000000, isFeatured: true, imageUrl: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&q=80' }),
    yoga: await useCases.catalog.createService({ categoryId: wellness.id, name: 'Clase de yoga personalizada', description: 'Clase individual adaptada a tu nivel, en casa o en línea.', durationMinutes: 60, bufferMinutes: 0, priceCents: 7000000, imageUrl: 'https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800&q=80' }),
  };

  // --- Profesionales ---
  const weekdays = (start: string, end: string, days = [1, 2, 3, 4, 5]) => days.map((weekday) => ({ weekday, startTime: start, endTime: end }));
  const daniel = await useCases.staff.create({
    email: 'daniel@reservaflow.app', password: DEMO_PASSWORD, firstName: 'Daniel', lastName: 'García', title: 'Técnico en sistemas',
    bio: 'Más de 8 años reparando equipos y montando redes para hogares y pymes. Puntual y detallista.',
    avatarUrl: 'https://i.pravatar.cc/300?img=12', phone: '+57 313 558 8787',
    serviceIds: [svc.pc.id, svc.net.id], workingHours: [...weekdays('09:00', '13:00'), ...weekdays('14:00', '18:00'), ...weekdays('09:00', '13:00', [6])],
  });
  const lulu = await useCases.staff.create({
    email: 'lulu@reservaflow.app', password: DEMO_PASSWORD, firstName: 'Lulú', lastName: 'Martínez', title: 'Especialista en hogar',
    bio: 'Limpieza profunda y organización de espacios con productos ecológicos.',
    avatarUrl: 'https://i.pravatar.cc/300?img=47', phone: '+57 313 544 5526',
    serviceIds: [svc.clean.id, svc.plumb.id], workingHours: weekdays('08:00', '17:00', [1, 2, 3, 4, 5, 6]),
  });
  const camila = await useCases.staff.create({
    email: 'camila@reservaflow.app', password: DEMO_PASSWORD, firstName: 'Camila', lastName: 'Torres', title: 'Terapeuta certificada',
    bio: 'Masajista y profesora de yoga. Sesiones a domicilio con enfoque en bienestar integral.',
    avatarUrl: 'https://i.pravatar.cc/300?img=32', phone: '+57 310 222 3344',
    serviceIds: [svc.massage.id, svc.yoga.id], workingHours: [...weekdays('10:00', '20:00', [1, 2, 3, 4, 5]), ...weekdays('10:00', '14:00', [0, 6])],
  });
  const mateo = await useCases.staff.create({
    email: 'mateo@reservaflow.app', password: DEMO_PASSWORD, firstName: 'Mateo', lastName: 'Hernández', title: 'Ingeniero de redes',
    bio: 'Certificado en redes y soporte técnico. Atiendo empresas y hogares.',
    avatarUrl: 'https://i.pravatar.cc/300?img=59', phone: '+57 320 999 1122',
    serviceIds: [svc.pc.id, svc.net.id, svc.plumb.id], workingHours: weekdays('07:00', '15:00'),
  });

  // --- Cupones ---
  await useCases.coupons.create({ code: 'BIENVENIDO10', description: '10% de descuento en tu primera reserva', discountType: 'PERCENT', value: 10, minAmountCents: 0, maxUses: 100, validFrom: null, validUntil: null, isActive: true });
  await useCases.coupons.create({ code: 'HOGAR20K', description: '$20.000 de descuento en servicios de hogar', discountType: 'FIXED', value: 2000000, minAmountCents: 9000000, maxUses: null, validFrom: null, validUntil: null, isActive: true });

  // --- Historial: reservas completadas + reseñas (insertadas directamente para no chocar con reglas de "pasado") ---
  const today = toLocalDate(clock.now());
  const past = (daysAgo: number, time: string) => `${addDays(today, -daysAgo)}T${time}`;
  const mk = (client: string, staff: typeof daniel, service: typeof svc.pc, startAt: string, status: 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' = 'COMPLETED') => ({
    id: crypto.randomUUID(), code: `RF-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, seriesId: null, seriesIndex: 0, frequency: 'ONCE' as const,
    clientId: client, staffId: staff.id, serviceId: service.id, startAt, endAt: `${startAt.slice(0, 11)}${String(Number(startAt.slice(11, 13)) + 1).padStart(2, '0')}:00`,
    status, priceCents: service.priceCents, discountCents: 0, totalCents: service.priceCents, couponCode: null, notes: null, address: null,
    cancelledAt: null, cancelReason: null, createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString(),
  });
  const history = [
    mk(andres.user.id, daniel, svc.pc, past(20, '10:00')),
    mk(paola.user.id, daniel, svc.net, past(12, '15:00')),
    mk(paola.user.id, lulu, svc.clean, past(9, '09:00')),
    mk(andres.user.id, camila, svc.massage, past(6, '11:00')),
    mk(paola.user.id, camila, svc.yoga, past(3, '18:00')),
    mk(andres.user.id, mateo, svc.pc, past(2, '08:00')),
    mk(andres.user.id, lulu, svc.plumb, past(15, '14:00'), 'CANCELLED'),
  ];
  await repos.bookings.saveMany(history);
  for (const b of history.filter((h) => h.status === 'COMPLETED')) {
    const s = await repos.staff.findById(b.staffId);
    if (s) await repos.staff.update({ ...s, completedJobs: s.completedJobs + 1, updatedAt: b.updatedAt });
  }
  const reviews: [typeof history[number], number, string][] = [
    [history[0], 5, 'La reparación de mi computadora fue rápida, muchas gracias. Daniel explicó todo con paciencia.'],
    [history[1], 4, 'Quedó excelente la red, aunque llegó 10 minutos tarde.'],
    [history[2], 5, 'Mi casa quedó impecable. Lulú es muy profesional y cuidadosa.'],
    [history[3], 5, 'El mejor masaje que me han dado. Camila es una genia.'],
    [history[4], 4, 'Muy buena clase, adaptada a mi nivel de principiante.'],
  ];
  for (const [b, rating, comment] of reviews) await useCases.reviews.create(b.clientId, b.id, rating, comment);

  // --- Reservas futuras de ejemplo ---
  const nextMonday = (() => { let d = addDays(today, 1); while (new Date(d + 'T00:00').getDay() !== 1) d = addDays(d, 1); return d; })();
  await useCases.bookings.create({ clientId: paola.user.id, staffId: daniel.id, serviceId: svc.pc.id, startAt: `${nextMonday}T10:00`, notes: 'La portátil no enciende.' });
  await useCases.bookings.create({ clientId: andres.user.id, staffId: lulu.id, serviceId: svc.clean.id, startAt: `${nextMonday}T09:00`, frequency: 'WEEKLY', occurrences: 4, couponCode: 'HOGAR20K' });
  await useCases.bookings.create({ clientId: paola.user.id, staffId: camila.id, serviceId: svc.yoga.id, startAt: `${addDays(nextMonday, 2)}T18:00`, frequency: 'BIWEEKLY', occurrences: 3 });

  logger.info({ admin: admin.user.email, password: DEMO_PASSWORD }, '✅ Datos de demostración creados');
};

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isDirectRun) {
  const container = buildContainer(loadEnv());
  seedDatabase(container)
    .then(() => container.db.close())
    .catch((e) => {
      logger.error(e);
      process.exit(1);
    });
}
