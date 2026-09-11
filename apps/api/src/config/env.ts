import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const durationRe = /^\d+[smhd]$/;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Rol de aplicación: SIN privilegios de dueño, para que RLS se aplique de verdad. */
  DATABASE_URL: z.string().min(1),
  /** Rol dueño del esquema. Solo lo usan las migraciones. */
  DATABASE_MIGRATION_URL: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  JWT_ACCESS_SECRET: z.string().min(16, 'El secreto de acceso debe tener al menos 16 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(16, 'El secreto de refresco debe tener al menos 16 caracteres'),
  JWT_ACCESS_TTL: z.string().regex(durationRe).default('15m'),
  JWT_REFRESH_TTL: z.string().regex(durationRe).default('7d'),

  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),

  MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  MAIL_FROM: z.string().default('Nexo ERP <no-reply@example.com>'),

  /** Desactiva los trabajos en segundo plano (tests, procesos efímeros). */
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export const loadEnv = (overrides: Partial<NodeJS.ProcessEnv> = {}): Env => {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  return parsed.data;
};

export const corsOrigins = (env: Env): string[] =>
  env.CORS_ORIGIN.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

/** URL con la que corren las migraciones: el rol dueño si está definido. */
export const migrationUrl = (env: Env): string => env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL;
