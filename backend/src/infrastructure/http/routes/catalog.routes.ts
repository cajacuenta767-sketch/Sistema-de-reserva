import { Router } from 'express';
import type { Container } from '../../container.js';
import { requireRole } from '../middlewares/auth.js';
import { q, validate } from '../middlewares/validate.js';
import { categoryBody, idParam, serviceBody, servicesQuery } from '../schemas.js';
import type { z } from 'zod';

export const catalogRoutes = (c: Container) => {
  const r = Router();
  const { catalog } = c.useCases;
  const admin = requireRole('ADMIN');

  r.get('/categories', async (_req, res) => res.json({ items: await catalog.listCategories() }));
  r.post('/categories', admin, validate({ body: categoryBody }), async (req, res) => res.status(201).json(await catalog.createCategory(req.body)));
  r.patch('/categories/:id', admin, validate({ params: idParam, body: categoryBody.partial() }), async (req, res) =>
    res.json(await catalog.updateCategory(String(req.params.id), req.body)),
  );
  r.delete('/categories/:id', admin, validate({ params: idParam }), async (req, res) => {
    await catalog.deleteCategory(String(req.params.id));
    res.status(204).end();
  });

  r.get('/services', validate({ query: servicesQuery }), async (req, res) => {
    const query = q<z.infer<typeof servicesQuery>>(req);
    const includeInactive = req.user?.role === 'ADMIN' && !!query.includeInactive;
    res.json({ items: await catalog.listServices({ categoryId: query.categoryId, includeInactive }) });
  });
  r.get('/services/:id', validate({ params: idParam }), async (req, res) => res.json(await catalog.getService(String(req.params.id))));
  r.post('/services', admin, validate({ body: serviceBody }), async (req, res) => res.status(201).json(await catalog.createService(req.body)));
  r.patch('/services/:id', admin, validate({ params: idParam, body: serviceBody.partial() }), async (req, res) =>
    res.json(await catalog.updateService(String(req.params.id), req.body)),
  );
  r.delete('/services/:id', admin, validate({ params: idParam }), async (req, res) => {
    await catalog.deleteService(String(req.params.id));
    res.status(204).end();
  });
  return r;
};
