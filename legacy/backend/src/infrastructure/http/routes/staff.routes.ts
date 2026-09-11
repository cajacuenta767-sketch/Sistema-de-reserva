import { Router } from 'express';
import type { z } from 'zod';
import type { Container } from '../../container.js';
import { AppError } from '../../../shared/AppError.js';
import { requireAuth, requireRole } from '../middlewares/auth.js';
import { q, validate } from '../middlewares/validate.js';
import {
  availabilityQuery,
  idParam,
  monthAvailabilityQuery,
  staffCreateBody,
  staffListQuery,
  staffUpdateBody,
  timeOffBody,
  workingHoursBody,
} from '../schemas.js';

export const staffRoutes = (c: Container) => {
  const r = Router();
  const { staff } = c.useCases;
  const admin = requireRole('ADMIN');

  /** El propio profesional o un admin pueden editar su agenda. */
  const selfOrAdmin = async (req: Parameters<typeof requireAuth>[0], staffId: string) => {
    if (req.user!.role === 'ADMIN') return;
    const mine = await c.repos.staff.findByUserId(req.user!.id);
    if (!mine || mine.id !== staffId) throw AppError.forbidden();
  };

  r.get('/', validate({ query: staffListQuery }), async (req, res) => {
    const query = q<z.infer<typeof staffListQuery>>(req);
    const includeInactive = req.user?.role === 'ADMIN' && !!query.includeInactive;
    res.json({ items: await staff.list({ serviceId: query.serviceId, availableOn: query.availableOn, includeInactive }) });
  });
  r.get('/me', requireRole('STAFF'), async (req, res) => res.json(await staff.getByUser(req.user!.id)));
  r.get('/:id', validate({ params: idParam }), async (req, res) => res.json(await staff.get(String(req.params.id))));
  r.post('/', admin, validate({ body: staffCreateBody }), async (req, res) => res.status(201).json(await staff.create(req.body)));
  r.patch('/:id', requireAuth, validate({ params: idParam, body: staffUpdateBody }), async (req, res) => {
    await selfOrAdmin(req, String(req.params.id));
    if (req.user!.role !== 'ADMIN') delete req.body.isActive;
    res.json(await staff.update(String(req.params.id), req.body));
  });
  r.delete('/:id', admin, validate({ params: idParam }), async (req, res) => {
    await staff.remove(String(req.params.id));
    res.status(204).end();
  });

  r.get('/:id/availability', validate({ params: idParam, query: availabilityQuery }), async (req, res) => {
    const query = q<z.infer<typeof availabilityQuery>>(req);
    res.json(await staff.availability(String(req.params.id), query.serviceId, query.date));
  });
  r.get('/:id/availability/month', validate({ params: idParam, query: monthAvailabilityQuery }), async (req, res) => {
    const query = q<z.infer<typeof monthAvailabilityQuery>>(req);
    res.json(await staff.monthAvailability(String(req.params.id), query.serviceId, query.month));
  });
  r.get('/:id/next-available', validate({ params: idParam, query: availabilityQuery.pick({ serviceId: true }) }), async (req, res) => {
    const query = q<{ serviceId: string }>(req);
    res.json(await staff.nextAvailableDate(String(req.params.id), query.serviceId));
  });

  r.get('/:id/working-hours', validate({ params: idParam }), async (req, res) => res.json({ items: await staff.workingHours(String(req.params.id)) }));
  r.put('/:id/working-hours', requireAuth, validate({ params: idParam, body: workingHoursBody }), async (req, res) => {
    await selfOrAdmin(req, String(req.params.id));
    res.json({ items: await staff.setWorkingHours(String(req.params.id), req.body.hours) });
  });
  r.get('/:id/time-off', requireAuth, validate({ params: idParam }), async (req, res) => {
    await selfOrAdmin(req, String(req.params.id));
    res.json({ items: await staff.timeOff(String(req.params.id)) });
  });
  r.post('/:id/time-off', requireAuth, validate({ params: idParam, body: timeOffBody }), async (req, res) => {
    await selfOrAdmin(req, String(req.params.id));
    res.status(201).json(await staff.addTimeOff(String(req.params.id), { ...req.body, reason: req.body.reason ?? null }));
  });
  r.delete('/:id/time-off/:timeOffId', requireAuth, validate({ params: idParam.extend({ timeOffId: idParam.shape.id }) }), async (req, res) => {
    await selfOrAdmin(req, String(req.params.id));
    await staff.removeTimeOff(String(req.params.timeOffId));
    res.status(204).end();
  });
  return r;
};
