import { Router } from 'express';
import type { Container } from '../../container.js';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { changePasswordBody, loginBody, profileBody, refreshBody, registerBody } from '../schemas.js';

export const authRoutes = (c: Container) => {
  const r = Router();
  const { auth } = c.useCases;

  r.post('/register', validate({ body: registerBody }), async (req, res) => {
    res.status(201).json(await auth.register(req.body));
  });
  r.post('/login', validate({ body: loginBody }), async (req, res) => {
    res.json(await auth.login(req.body.email, req.body.password));
  });
  r.post('/refresh', validate({ body: refreshBody }), async (req, res) => {
    res.json(await auth.refresh(req.body.refreshToken));
  });
  r.get('/me', requireAuth, async (req, res) => {
    const user = await auth.me(req.user!.id);
    const staffProfile = user.role === 'STAFF' ? await c.repos.staff.findByUserId(user.id) : null;
    res.json({ user, staffProfile });
  });
  r.patch('/me', requireAuth, validate({ body: profileBody }), async (req, res) => {
    res.json({ user: await auth.updateProfile(req.user!.id, req.body) });
  });
  r.post('/change-password', requireAuth, validate({ body: changePasswordBody }), async (req, res) => {
    await auth.changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword);
    res.status(204).end();
  });
  return r;
};
