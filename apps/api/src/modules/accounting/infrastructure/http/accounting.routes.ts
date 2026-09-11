import { Router } from 'express';
import { z } from 'zod';
import { idParam, listQuerySchema } from '@erp/contracts';
import type { ModuleContext } from '../../../../platform/modules/types.js';
import type { Request } from 'express';
import { q as validatedQuery, validate } from '../../../../platform/http/middlewares/validate.js';
import { requireOrganization } from '../../../../platform/http/middlewares/auth.js';
import { listQueryOf, tenantRoute } from '../../../../platform/http/handlers.js';
import type { ChartUseCases } from '../../application/use-cases/ChartUseCases.js';
import type { PeriodUseCases } from '../../application/use-cases/PeriodUseCases.js';
import type { EntryUseCases } from '../../application/use-cases/EntryUseCases.js';
import type { ReportUseCases } from '../../application/use-cases/ReportUseCases.js';
import type { JournalRepository } from '../../application/ports/AccountingRepositories.js';
import { ACCOUNT_ROLES } from '../../domain/AccountRoles.js';

const money = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Importe inválido');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
const ROLE_KEYS = ACCOUNT_ROLES.map((r) => r.role) as [string, ...string[]];

const onlyActiveQuery = z.object({ onlyActive: z.coerce.boolean().optional() });
const q = (req: Request) => validatedQuery<z.infer<typeof onlyActiveQuery>>(req);

const accountBody = z.object({
  code: z.string().trim().regex(/^[1-9][0-9]*$/, 'El código debe ser numérico'),
  name: z.string().trim().min(1).max(200),
  nature: z.enum(['DEBIT', 'CREDIT']).optional(),
  isPostable: z.boolean().optional(),
  isActive: z.boolean().optional(),
  requiresParty: z.boolean().optional(),
  requiresCostCenter: z.boolean().optional(),
  isCash: z.boolean().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

const entryBody = z.object({
  date: isoDate,
  memo: z.string().trim().min(1).max(500),
  journalType: z
    .enum(['SALES', 'PURCHASES', 'CASH', 'PAYROLL', 'GENERAL', 'OPENING', 'CLOSING', 'INVENTORY'])
    .optional(),
  currencyCode: z.string().length(3).optional(),
  exchangeRate: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
  lines: z
    .array(
      z.object({
        accountId: z.uuid(),
        debit: money.optional(),
        credit: money.optional(),
        description: z.string().trim().max(500).optional(),
        partyId: z.uuid().nullable().optional(),
        costCenterId: z.uuid().nullable().optional(),
        reference: z.string().trim().max(60).nullable().optional(),
      }),
    )
    .min(2, 'Un asiento mueve al menos dos cuentas'),
});

const reportQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  accountId: z.uuid().optional(),
  partyId: z.uuid().optional(),
  costCenterId: z.uuid().optional(),
  includeZero: z.coerce.boolean().optional(),
});

export const accountingRoutes = (
  ctx: ModuleContext,
  api: {
    chart: ChartUseCases;
    periods: PeriodUseCases;
    entries: EntryUseCases;
    reports: ReportUseCases;
    journalRepo: JournalRepository;
  },
): Router => {
  const r = Router();
  const { pool, requirePermission: can } = ctx;
  r.use(requireOrganization);

  // ── Plan de cuentas ───────────────────────────────────────────────────────
  r.get(
    '/accounts',
    can('accounting:account:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.chart.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/accounts/tree',
    can('accounting:account:read'),
    validate({ query: onlyActiveQuery }),
    // Se lee de `validatedQuery`, no de `req.query`: en Express 5 `req.query` es
    // un getter de solo lectura con los valores en crudo, así que la coerción
    // que hizo Zod se perdería justo aquí.
    tenantRoute(pool, (tx, c, req) => api.chart.tree(c, tx, q(req)?.onlyActive ?? false)),
  );

  r.get(
    '/accounts/:id',
    can('accounting:account:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.chart.get(c, tx, String(req.params.id))),
  );

  r.post(
    '/accounts',
    can('accounting:account:create'),
    validate({ body: accountBody }),
    tenantRoute(pool, (tx, c, req) => api.chart.create(c, tx, accountBody.parse(req.body)), 201),
  );

  r.patch(
    '/accounts/:id',
    can('accounting:account:update'),
    validate({ params: idParam, body: accountBody.partial() }),
    tenantRoute(pool, (tx, c, req) =>
      api.chart.update(c, tx, String(req.params.id), accountBody.partial().parse(req.body)),
    ),
  );

  r.delete(
    '/accounts/:id',
    can('accounting:account:delete'),
    validate({ params: idParam }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.chart.remove(c, tx, String(req.params.id));
      return null;
    }),
  );

  // ── Cuentas por operación ─────────────────────────────────────────────────
  r.get(
    '/account-roles',
    can('accounting:account:read'),
    tenantRoute(pool, (tx, c) => api.chart.roles(c, tx)),
  );

  r.put(
    '/account-roles/:role',
    can('accounting:account:update'),
    validate({
      params: z.object({ role: z.enum(ROLE_KEYS) }),
      body: z.object({ accountId: z.uuid() }),
    }),
    tenantRoute(pool, async (tx, c, req) => {
      await api.chart.setRole(
        c,
        tx,
        String(req.params.role) as (typeof ACCOUNT_ROLES)[number]['role'],
        z.object({ accountId: z.uuid() }).parse(req.body).accountId,
      );
      return api.chart.roles(c, tx);
    }),
  );

  // ── Diarios ───────────────────────────────────────────────────────────────
  r.get(
    '/journals',
    can('accounting:journal:read'),
    tenantRoute(pool, (tx, c) => api.chart.journals(c, tx, api.journalRepo)),
  );

  // ── Años y periodos ───────────────────────────────────────────────────────
  r.get(
    '/fiscal-years',
    can('accounting:period:read'),
    tenantRoute(pool, (tx, c) => api.periods.list(c, tx)),
  );

  r.get(
    '/fiscal-years/:id',
    can('accounting:period:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.periods.get(c, tx, String(req.params.id))),
  );

  r.post(
    '/fiscal-years',
    can('accounting:period:manage'),
    validate({
      body: z.object({
        year: z.coerce.number().int().min(2000).max(2200),
        withAdjustmentPeriod: z.boolean().optional(),
      }),
    }),
    tenantRoute(
      pool,
      (tx, c, req) => {
        const body = z
          .object({
            year: z.coerce.number().int(),
            withAdjustmentPeriod: z.boolean().optional(),
          })
          .parse(req.body);
        return api.periods.openYear(c, tx, body.year, body.withAdjustmentPeriod ?? true);
      },
      201,
    ),
  );

  r.post(
    '/fiscal-years/:id/close',
    can('accounting:period:close'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.periods.closeYear(c, tx, String(req.params.id))),
  );

  r.post(
    '/fiscal-years/:id/reopen',
    can('accounting:period:reopen'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.periods.reopenYear(c, tx, String(req.params.id))),
  );

  r.post(
    '/periods/:id/close',
    can('accounting:period:close'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.periods.closePeriod(c, tx, String(req.params.id))),
  );

  r.post(
    '/periods/:id/reopen',
    can('accounting:period:reopen'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.periods.reopenPeriod(c, tx, String(req.params.id))),
  );

  // ── Asientos ──────────────────────────────────────────────────────────────
  r.get(
    '/entries',
    can('accounting:entry:read'),
    validate({ query: listQuerySchema }),
    tenantRoute(pool, (tx, c, req) => api.entries.list(c, tx, listQueryOf(req))),
  );

  r.get(
    '/entries/:id',
    can('accounting:entry:read'),
    validate({ params: idParam }),
    tenantRoute(pool, (tx, c, req) => api.entries.get(c, tx, String(req.params.id))),
  );

  /** El asiento de un documento: es el "ver contabilización" de la factura. */
  r.get(
    '/entries/by-source/:type/:id',
    can('accounting:entry:read'),
    validate({ params: z.object({ type: z.string().max(40), id: z.uuid() }) }),
    tenantRoute(pool, (tx, c, req) =>
      api.entries.forSource(c, tx, String(req.params.type), String(req.params.id)),
    ),
  );

  r.post(
    '/entries',
    can('accounting:entry:create'),
    validate({ body: entryBody }),
    tenantRoute(pool, (tx, c, req) => api.entries.createManual(c, tx, entryBody.parse(req.body)), 201),
  );

  r.post(
    '/entries/:id/reverse',
    can('accounting:entry:reverse'),
    validate({
      params: idParam,
      body: z.object({ reason: z.string().trim().min(1).max(500), date: isoDate.optional() }),
    }),
    tenantRoute(pool, (tx, c, req) => {
      const body = z
        .object({ reason: z.string().trim(), date: isoDate.optional() })
        .parse(req.body);
      return api.entries.reverse(c, tx, String(req.params.id), body.reason, body.date);
    }),
  );

  // ── Informes ──────────────────────────────────────────────────────────────
  r.get(
    '/reports/trial-balance',
    can('accounting:report:read'),
    validate({ query: reportQuery }),
    tenantRoute(pool, (tx, c, req) => {
      const q = reportQuery.parse(req.query);
      return api.reports.trialBalance(c, tx, q.from, q.to, {
        includeZero: q.includeZero,
        costCenterId: q.costCenterId ?? null,
      });
    }),
  );

  r.get(
    '/reports/income-statement',
    can('accounting:report:read'),
    validate({ query: reportQuery }),
    tenantRoute(pool, (tx, c, req) => {
      const q = reportQuery.parse(req.query);
      return api.reports.incomeStatement(c, tx, q.from, q.to, q.costCenterId ?? null);
    }),
  );

  r.get(
    '/reports/balance-sheet',
    can('accounting:report:read'),
    validate({ query: reportQuery }),
    tenantRoute(pool, (tx, c, req) => {
      const q = reportQuery.parse(req.query);
      return api.reports.balanceSheet(c, tx, q.to, q.from);
    }),
  );

  r.get(
    '/reports/ledger',
    can('accounting:report:read'),
    validate({ query: reportQuery }),
    tenantRoute(pool, (tx, c, req) => {
      const q = reportQuery.parse(req.query);
      return api.reports.ledger(c, tx, {
        from: q.from ?? '1900-01-01',
        to: q.to ?? '2999-12-31',
        accountId: q.accountId ?? null,
        partyId: q.partyId ?? null,
        costCenterId: q.costCenterId ?? null,
      });
    }),
  );

  r.get(
    '/reports/party-subledger',
    can('accounting:report:read'),
    validate({ query: reportQuery }),
    tenantRoute(pool, (tx, c, req) => {
      const q = reportQuery.parse(req.query);
      return api.reports.partySubledger(c, tx, q.from, q.to, q.accountId ?? null);
    }),
  );

  return r;
};
