import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Container } from '../container.js';
import { authenticate } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/error.js';
import { openapi } from './openapi.js';
import { authRoutes } from './routes/auth.routes.js';
import { bookingRoutes } from './routes/booking.routes.js';
import { catalogRoutes } from './routes/catalog.routes.js';
import { adminRoutes, couponRoutes, notificationRoutes, reviewRoutes, waitlistRoutes } from './routes/misc.routes.js';
import { staffRoutes } from './routes/staff.routes.js';

export const createApp = (c: Container) => {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: c.env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(authenticate(c.tokens));

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ status: 'ok', time: c.clock.now().toISOString(), version: '1.0.0' }));
  api.get('/openapi.json', (_req, res) => res.json(openapi));

  const isTest = c.env.NODE_ENV === 'test';
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: isTest ? 10_000 : 30, standardHeaders: true, legacyHeaders: false });
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: isTest ? 100_000 : 300, standardHeaders: true, legacyHeaders: false });
  api.use(apiLimiter);

  api.use('/auth', authLimiter, authRoutes(c));
  api.use('/', catalogRoutes(c));
  api.use('/staff', staffRoutes(c));
  api.use('/bookings', bookingRoutes(c));
  api.use('/reviews', reviewRoutes(c));
  api.use('/coupons', couponRoutes(c));
  api.use('/notifications', notificationRoutes(c));
  api.use('/waitlist', waitlistRoutes(c));
  api.use('/admin', adminRoutes(c));

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
