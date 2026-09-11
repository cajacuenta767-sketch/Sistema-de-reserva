import { pino, type Logger } from 'pino';
import type { Env } from '../../config/env.js';

export type { Logger };

export const createLogger = (env: Env): Logger =>
  pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: undefined,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        '*.password',
        '*.passwordHash',
        '*.refreshToken',
        '*.accessToken',
        '*.totpSecret',
      ],
      censor: '[redactado]',
    },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
      : {}),
  });
