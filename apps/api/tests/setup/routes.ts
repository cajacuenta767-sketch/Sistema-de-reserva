import type { Container } from '../../src/platform/modules/container.js';
import { API_PREFIX } from '../../src/bootstrap/app.js';
import type { RouteInfo } from '../../src/platform/modules/registry.js';

export type { RouteInfo };

/**
 * Rutas REALMENTE montadas, con su prefijo completo.
 *
 * Se leen del registro de módulos y no del router de Express: Express 5 no
 * permite recuperar el prefijo de montaje (su matcher es un cierre), así que
 * recorrerlo daría rutas sin `/api/v1` que devolverían 404 y harían que el test
 * de permisos pasara sin comprobar nada.
 */
export const collectRoutes = (container: Container): RouteInfo[] =>
  container.registry.routeTable().map((r) => ({ ...r, path: `${API_PREFIX}${r.path}` }));
