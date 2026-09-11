import pino from 'pino';

const isTest = process.env.NODE_ENV === 'test' || !!process.env.VITEST;
const isDev = process.env.NODE_ENV !== 'production' && !isTest;

export const logger = pino({
  level: isTest ? 'silent' : process.env.LOG_LEVEL ?? 'info',
  ...(isDev ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } } : {}),
});
