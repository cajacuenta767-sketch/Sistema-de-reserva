import request from 'supertest';
import { loadEnv } from '../src/config/env.js';
import { FixedClock } from '../src/shared/Clock.js';
import { buildContainer } from '../src/infrastructure/container.js';
import { openDatabase } from '../src/infrastructure/db/connection.js';
import { createApp } from '../src/infrastructure/http/app.js';
import { seedDatabase, DEMO_PASSWORD } from '../src/infrastructure/db/seed.js';

/** Martes 2026-03-10 09:00 hora local */
export const NOW = new Date(2026, 2, 10, 9, 0, 0);

export const makeTestApp = async (opts: { seed?: boolean } = {}) => {
  process.env.NODE_ENV = 'test';
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' });
  const clock = new FixedClock(NOW);
  const container = buildContainer(env, { clock, db: openDatabase(':memory:') });
  if (opts.seed !== false) await seedDatabase(container);
  const app = createApp(container);
  const api = request(app);

  const login = async (email: string, password = DEMO_PASSWORD) => {
    const res = await api.post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
    return res.body.tokens.accessToken as string;
  };
  return { app, api, container, clock, login };
};
