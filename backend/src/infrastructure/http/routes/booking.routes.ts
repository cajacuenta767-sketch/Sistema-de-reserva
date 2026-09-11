import { Router } from 'express';
import type { z } from 'zod';
import type { Container } from '../../container.js';
import type { BookingStatus } from '../../../domain/entities/Booking.js';
import { DEFAULT_OCCURRENCES } from '../../../domain/services/RecurrenceGenerator.js';
import { toLocalDateTime } from '../../../shared/dates.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { q, validate } from '../middlewares/validate.js';
import { bookingCreateBody, bookingListQuery, bookingQuoteBody, cancelBody, idParam, rescheduleBody, statusBody } from '../schemas.js';

export const bookingRoutes = (c: Container) => {
  const r = Router();
  const { bookings, auth } = c.useCases;

  /** Enriquecemos con nombres de servicio/profesional para que el frontend no haga N llamadas. */
  const enrich = async (list: Awaited<ReturnType<typeof bookings.get>>[]) => {
    const staffIds = [...new Set(list.map((b) => b.staffId))];
    const serviceIds = [...new Set(list.map((b) => b.serviceId))];
    const clientIds = [...new Set(list.map((b) => b.clientId))];
    const [staffList, services, clients, reviewed] = await Promise.all([
      Promise.all(staffIds.map((id) => c.repos.staff.findById(id))),
      Promise.all(serviceIds.map((id) => c.repos.services.findById(id))),
      Promise.all(clientIds.map((id) => c.repos.users.findById(id))),
      Promise.all(list.map((b) => c.repos.reviews.findByBookingId(b.id))),
    ]);
    return list.map((b, i) => {
      const s = staffList.find((x) => x?.id === b.staffId);
      const sv = services.find((x) => x?.id === b.serviceId);
      const cl = clients.find((x) => x?.id === b.clientId);
      return {
        ...b,
        staff: s ? { id: s.id, displayName: s.displayName, avatarUrl: s.avatarUrl, title: s.title } : null,
        service: sv ? { id: sv.id, name: sv.name, durationMinutes: sv.durationMinutes, currency: sv.currency } : null,
        client: cl ? { id: cl.id, firstName: cl.firstName, lastName: cl.lastName, email: cl.email, phone: cl.phone } : null,
        hasReview: !!reviewed[i],
      };
    });
  };

  r.post('/quote', validate({ body: bookingQuoteBody }), async (req, res) => {
    const occ = req.body.occurrences ?? DEFAULT_OCCURRENCES[(req.body.frequency ?? 'ONCE') as keyof typeof DEFAULT_OCCURRENCES];
    res.json(await bookings.quote(req.body.serviceId, req.body.couponCode, req.body.frequency === 'ONCE' || !req.body.frequency ? 1 : occ));
  });

  r.get('/', requireAuth, validate({ query: bookingListQuery }), async (req, res) => {
    const query = q<z.infer<typeof bookingListQuery>>(req);
    const status = query.status?.split(',').filter(Boolean) as BookingStatus[] | undefined;
    const from = query.upcoming ? toLocalDateTime(c.clock.now()) : query.from;
    const { items, total } = await bookings.list(req.user!, { ...query, status, from });
    res.json({ items: await enrich(items), total });
  });

  r.get('/code/:code', async (req, res) => {
    const [item] = await enrich([await bookings.getByCode(String(req.params.code))]);
    res.json(item);
  });

  r.get('/:id', requireAuth, validate({ params: idParam }), async (req, res) => {
    const [item] = await enrich([await bookings.get(req.user!, String(req.params.id))]);
    res.json(item);
  });

  r.post('/', requireAuth, validate({ body: bookingCreateBody }), async (req, res) => {
    const { contact, ...input } = req.body;
    if (contact && Object.keys(contact).length) await auth.updateProfile(req.user!.id, contact);
    const created = await bookings.create({ ...input, clientId: req.user!.id });
    res.status(201).json({ items: await enrich(created), seriesId: created[0].seriesId });
  });

  r.post('/:id/cancel', requireAuth, validate({ params: idParam, body: cancelBody }), async (req, res) => {
    const cancelled = await bookings.cancel(req.user!, String(req.params.id), req.body.reason, req.body.wholeSeries);
    res.json({ items: await enrich(cancelled) });
  });

  r.post('/:id/reschedule', requireAuth, validate({ params: idParam, body: rescheduleBody }), async (req, res) => {
    const [item] = await enrich([await bookings.reschedule(req.user!, String(req.params.id), req.body.startAt)]);
    res.json(item);
  });

  r.post('/:id/status', requireRole('STAFF', 'ADMIN'), validate({ params: idParam, body: statusBody }), async (req, res) => {
    const [item] = await enrich([await bookings.changeStatus(req.user!, String(req.params.id), req.body.status)]);
    res.json(item);
  });

  r.post('/reminders/run', requireRole('ADMIN'), async (_req, res) => {
    res.json({ sent: await bookings.sendReminders(24) });
  });
  return r;
};
