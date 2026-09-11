import { Router } from 'express';
import type { z } from 'zod';
import type { Container } from '../../container.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { q, validate } from '../middlewares/validate.js';
import { couponBody, couponValidateBody, idParam, markReadBody, notificationsQuery, reviewBody, reviewsQuery, statsQuery, waitlistBody } from '../schemas.js';

export const reviewRoutes = (c: Container) => {
  const r = Router();
  r.get('/', validate({ query: reviewsQuery }), async (req, res) => {
    const query = q<z.infer<typeof reviewsQuery>>(req);
    const items = await c.useCases.reviews.list(query);
    const users = await Promise.all(items.map((i) => c.repos.users.findById(i.clientId)));
    const staff = await Promise.all(items.map((i) => c.repos.staff.findById(i.staffId)));
    const services = await Promise.all(items.map((i) => c.repos.services.findById(i.serviceId)));
    res.json({
      items: items.map((i, idx) => ({
        ...i,
        clientName: users[idx] ? `${users[idx]!.firstName} ${users[idx]!.lastName.charAt(0)}.` : 'Cliente',
        staffName: staff[idx]?.displayName ?? null,
        serviceName: services[idx]?.name ?? null,
      })),
    });
  });
  r.post('/', requireAuth, validate({ body: reviewBody }), async (req, res) => {
    res.status(201).json(await c.useCases.reviews.create(req.user!.id, req.body.bookingId, req.body.rating, req.body.comment));
  });
  return r;
};

export const couponRoutes = (c: Container) => {
  const r = Router();
  const admin = requireRole('ADMIN');
  r.post('/validate', validate({ body: couponValidateBody }), async (req, res) => {
    res.json(await c.useCases.bookings.quote(req.body.serviceId, req.body.code, 1));
  });
  r.get('/', admin, async (_req, res) => res.json({ items: await c.useCases.coupons.list() }));
  r.post('/', admin, validate({ body: couponBody }), async (req, res) => res.status(201).json(await c.useCases.coupons.create(req.body)));
  r.patch('/:id', admin, validate({ params: idParam, body: couponBody.partial() }), async (req, res) =>
    res.json(await c.useCases.coupons.update(String(req.params.id), req.body)),
  );
  r.delete('/:id', admin, validate({ params: idParam }), async (req, res) => {
    await c.useCases.coupons.remove(String(req.params.id));
    res.status(204).end();
  });
  return r;
};

export const notificationRoutes = (c: Container) => {
  const r = Router();
  r.use(requireAuth);
  r.get('/', validate({ query: notificationsQuery }), async (req, res) => {
    const query = q<z.infer<typeof notificationsQuery>>(req);
    res.json(await c.useCases.notifications.list(req.user!.id, !!query.unreadOnly));
  });
  r.post('/read', validate({ body: markReadBody }), async (req, res) => {
    res.json({ updated: await c.useCases.notifications.markRead(req.user!.id, req.body.ids) });
  });
  return r;
};

export const waitlistRoutes = (c: Container) => {
  const r = Router();
  r.use(requireAuth);
  r.get('/', async (req, res) => res.json({ items: await c.useCases.waitlist.listMine(req.user!.id) }));
  r.post('/', validate({ body: waitlistBody }), async (req, res) =>
    res.status(201).json(await c.useCases.waitlist.join(req.user!.id, req.body.serviceId, req.body.date, req.body.staffId ?? null)),
  );
  r.delete('/:id', validate({ params: idParam }), async (req, res) => {
    await c.useCases.waitlist.leave(req.user!.id, String(req.params.id));
    res.status(204).end();
  });
  return r;
};

export const adminRoutes = (c: Container) => {
  const r = Router();
  r.use(requireRole('ADMIN'));
  r.get('/stats', validate({ query: statsQuery }), async (req, res) => {
    const query = q<z.infer<typeof statsQuery>>(req);
    res.json(await c.useCases.admin.stats(query.from, query.to));
  });
  r.get('/users', async (_req, res) => res.json({ items: await c.useCases.admin.listUsers() }));
  r.get('/outbox', async (_req, res) => res.json({ items: c.mailer.sent.slice(-50).reverse() }));
  return r;
};
