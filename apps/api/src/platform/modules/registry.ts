import { Router } from 'express';
import type { ModuleContext, ModuleDefinition } from './types.js';

export interface RouteInfo {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  module?: string;
}

interface RouterLayer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle?: { stack?: RouterLayer[] };
}

/** Extrae las rutas de un Router de Express. Las rutas hijas son relativas, que
 *  es justo lo que se necesita: el prefijo lo pone quien monta. */
const routesOf = (router: Router): RouteInfo[] => {
  const found: RouteInfo[] = [];
  const walk = (layers: RouterLayer[]): void => {
    for (const layer of layers) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        for (const path of paths) {
          for (const method of Object.keys(layer.route.methods)) {
            if (method !== '_all') found.push({ method: method as RouteInfo['method'], path });
          }
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((router as unknown as { stack: RouterLayer[] }).stack ?? []);
  return found;
};

interface RegisteredModule {
  def: ModuleDefinition<string, unknown>;
  api: unknown;
}

/**
 * Registro de módulos.
 *
 * Hace tres cosas y ninguna más: ordenar los módulos por dependencias,
 * registrarlos en ese orden, y dar acceso a la API pública de cada uno. Son
 * unas 120 líneas que sustituyen a la inyección de dependencias de un framework,
 * con tipado completo y sin decoradores ni metadatos en tiempo de ejecución.
 */
export class ModuleRegistry {
  private readonly modules = new Map<string, RegisteredModule>();

  /**
   * Orden topológico por `dependsOn`. Un ciclo aquí es un error de diseño que
   * debe verse al arrancar, no un cuelgue silencioso, así que se detecta y se
   * informa con el camino exacto.
   */
  static sort(defs: readonly ModuleDefinition<string, unknown>[]): ModuleDefinition<string, unknown>[] {
    const byId = new Map(defs.map((d) => [d.id, d]));
    const sorted: ModuleDefinition<string, unknown>[] = [];
    const state = new Map<string, 'visiting' | 'done'>();

    const visit = (id: string, path: string[]): void => {
      const status = state.get(id);
      if (status === 'done') return;
      if (status === 'visiting') {
        throw new Error(`Ciclo de dependencias entre módulos: ${[...path, id].join(' → ')}`);
      }

      const def = byId.get(id);
      if (!def) {
        throw new Error(
          `El módulo "${path[path.length - 1] ?? '?'}" depende de "${id}", que no está registrado.`,
        );
      }

      state.set(id, 'visiting');
      for (const dep of def.dependsOn ?? []) visit(dep, [...path, id]);
      state.set(id, 'done');
      sorted.push(def);
    };

    for (const def of defs) visit(def.id, []);
    return sorted;
  }

  register(def: ModuleDefinition<string, unknown>, ctx: ModuleContext): void {
    if (this.modules.has(def.id)) throw new Error(`El módulo "${def.id}" se registró dos veces`);
    if (def.permissions?.length) ctx.permissions.register(def.permissions, def.id);
    this.modules.set(def.id, { def, api: def.register(ctx) });
  }

  get<T = unknown>(id: string): T {
    const entry = this.modules.get(id);
    if (!entry) {
      throw new Error(
        `El módulo "${id}" no está registrado. ` +
          'Si lo necesitas, decláralo en `dependsOn` y añádelo a modules/index.ts.',
      );
    }
    return entry.api as T;
  }

  has(id: string): boolean {
    return this.modules.has(id);
  }

  ids(): string[] {
    return [...this.modules.keys()];
  }

  private readonly routes: RouteInfo[] = [];

  /**
   * Monta las rutas de todos los módulos bajo su `basePath` y, de paso, anota
   * la tabla de rutas.
   *
   * Se anota aquí porque Express 5 NO permite recuperar el prefijo de montaje
   * después: su matcher es un cierre sobre una expresión regular, sin la ruta
   * original. Y sin la tabla, un test que recorra las rutas para comprobar
   * permisos probaría rutas inexistentes y pasaría en vacío, que es peor que no
   * tenerlo. La tabla sirve además para generar el OpenAPI.
   */
  buildRouter(ctx: ModuleContext): Router {
    const router = Router();
    for (const { def, api } of this.modules.values()) {
      if (!def.routes) continue;
      const basePath = def.basePath ?? '';
      const sub = def.routes(ctx, api);
      this.routes.push(...routesOf(sub).map((r) => ({ ...r, module: def.id, path: basePath + r.path })));
      router.use(basePath, sub);
    }
    return router;
  }

  /** Tabla de rutas montadas, relativa a la raíz de la API. */
  routeTable(): readonly RouteInfo[] {
    return this.routes;
  }

  /** Conecta suscripciones, trabajos y proveedores de búsqueda. */
  wire(ctx: ModuleContext): void {
    for (const { def, api } of this.modules.values()) {
      if (def.subscriptions) ctx.events.subscribe(def.subscriptions(ctx, api));
      if (def.jobs) ctx.jobs.register(def.jobs(ctx, api));
      if (def.search) ctx.search.register(def.search(ctx, api));
      if (def.imports) ctx.imports.register(def.imports(ctx, api));
    }
  }

  async boot(ctx: ModuleContext): Promise<void> {
    for (const { def, api } of this.modules.values()) {
      if (def.onBoot) await def.onBoot(ctx, api);
    }
  }
}
