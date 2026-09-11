import type { Request, RequestHandler } from 'express';
import type pg from 'pg';
import { listQuerySchema, normalizeListQuery, type ListQuery } from '@erp/contracts';
import { withTenant, withoutTenant } from '../db/tenancy.js';
import type { Tx } from '../db/unitOfWork.js';
import { requireContext, type RequestContext } from '../authz/RequestContext.js';
import { q } from './middlewares/validate.js';

/**
 * Envoltorios de ruta.
 *
 * Sin esto, cada endpoint repite el mismo `.then(...).catch(next)` y, tarde o
 * temprano, alguien olvida el `catch` y una promesa rechazada tumba el proceso.
 * Además concentran en un sitio la decisión de abrir la transacción con el
 * tenant fijado, que es lo que hace efectivo el aislamiento por RLS.
 */

type Responder<T> = (result: T, req: Request) => void;

const defaultStatus =
  (status: number): Responder<unknown> =>
  (result, req) => {
    const res = req.res;
    if (!res) return;
    if (result === undefined || result === null) res.status(204).end();
    else res.status(status).json(result);
  };

/** Ruta sin transacción: para lo que ya la abre por dentro (autenticación). */
export const route =
  <T>(fn: (req: Request) => Promise<T>, status = 200): RequestHandler =>
  (req, res, next) => {
    fn(req)
      .then((result) => defaultStatus(status)(result, req))
      .catch(next);
    void res;
  };

/** Ruta dentro de una transacción con la organización activa fijada. */
export const tenantRoute =
  <T>(
    pool: pg.Pool,
    fn: (tx: Tx, ctx: RequestContext, req: Request) => Promise<T>,
    status = 200,
  ): RequestHandler =>
  (req, res, next) => {
    const ctx = (() => {
      try {
        return requireContext(req.ctx);
      } catch (err) {
        next(err);
        return null;
      }
    })();
    if (!ctx) return;

    withTenant(
      pool,
      { organizationId: ctx.organizationId, membershipId: ctx.membershipId, userId: ctx.user.id },
      (tx) => fn(tx, ctx, req),
    )
      .then((result) => defaultStatus(status)(result, req))
      .catch(next);
    void res;
  };

/** Ruta transaccional SIN tenant: registro, login y aceptación de invitaciones. */
export const publicRoute =
  <T>(pool: pg.Pool, fn: (tx: Tx, req: Request) => Promise<T>, status = 200): RequestHandler =>
  (req, res, next) => {
    withoutTenant(pool, (tx) => fn(tx, req))
      .then((result) => defaultStatus(status)(result, req))
      .catch(next);
    void res;
  };

/** Lee y normaliza la consulta de listado ya validada. */
export const listQueryOf = (req: Request): ListQuery =>
  normalizeListQuery(q<ReturnType<typeof listQuerySchema.parse>>(req) ?? listQuerySchema.parse({}));
