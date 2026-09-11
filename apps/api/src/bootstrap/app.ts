import express, { type Express, Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { corsOrigins } from '../config/env.js';
import type { Container } from '../platform/modules/container.js';
import { requestContext } from '../platform/http/middlewares/requestContext.js';
import { createAuthenticate, type ContextLoader } from '../platform/http/middlewares/auth.js';
import { createErrorHandler, notFoundHandler } from '../platform/http/middlewares/error.js';

export const API_PREFIX = '/api/v1';

/**
 * Construye la aplicación HTTP.
 *
 * Este archivo tampoco crece con el sistema: cablea lo transversal y delega el
 * montaje de rutas al registro de módulos.
 */
export const createApp = (container: Container): Express => {
  const { env, ctx, registry, logger } = container;
  const app = express();

  app.disable('x-powered-by');
  // Express 5 usa el parser 'simple' por defecto, que NO entiende
  // `filter[status][gte]=...`. El contrato de listado lo necesita.
  app.set('query parser', 'extended');
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: corsOrigins(env), credentials: true, exposedHeaders: ['x-request-id'] }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(requestContext);

  // El módulo de identidad resuelve quién pide las cosas. La plataforma no lo
  // importa (la regla de boundaries lo impide): lo pide al registro por su id.
  const identity = registry.get<{ contextLoader: ContextLoader }>('identity');
  app.use(createAuthenticate(ctx.tokens, identity.contextLoader));

  const api = Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', modules: registry.ids(), permissions: container.permissions.size });
  });

  /*
   * Límite contra la prueba de contraseñas.
   *
   * Se aplica a los endpoints donde se PRUEBAN credenciales, no a todo `/auth`.
   * `/auth/session` es una lectura de la sesión en curso y la web la pide en
   * cada carga de página: metida bajo el mismo límite, alguien que trabaje una
   * mañana recargando pantallas agota la cuota y la aplicación lo manda al login
   * con la sesión intacta. El error se parece tanto a "te caducó la sesión" que
   * nadie lo reporta como el fallo que es.
   *
   * `/auth/logout` tampoco: impedir cerrar sesión no protege de nada.
   */
  const credentialLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.AUTH_RATE_LIMIT,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Demasiados intentos. Espera unos minutos.' } },
  });
  for (const path of ['/auth/login', '/auth/register', '/auth/refresh', '/auth/switch-organization']) {
    api.use(path, credentialLimiter);
  }

  api.use(registry.buildRouter(ctx));
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
};
