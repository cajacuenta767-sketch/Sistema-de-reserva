import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_PATH: z.string().default('./data/reservaflow.db'),
  JWT_ACCESS_SECRET: z.string().min(8).default('dev-access-secret-cambiar'),
  JWT_REFRESH_SECRET: z.string().min(8).default('dev-refresh-secret-cambiar'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  BUSINESS_TIMEZONE: z.string().default('America/Bogota'),
});

export type Env = z.infer<typeof schema>;

export const loadEnv = (overrides: Partial<Record<keyof Env, string>> = {}): Env => {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    throw new Error(`Configuración inválida: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
};
