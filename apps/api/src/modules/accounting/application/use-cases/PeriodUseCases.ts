import { AppError, newId, type Clock, type LocalDate } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import { actorMembershipId, type RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import {
  assertClosableInOrder,
  assertReopenableInOrder,
  fiscalYearRange,
  monthlyPeriods,
} from '../../domain/Periods.js';
import type {
  FiscalYearRecord,
  FiscalYearRepository,
  PeriodRecord,
  PeriodRepository,
} from '../ports/AccountingRepositories.js';

export interface YearWithPeriods {
  year: FiscalYearRecord;
  periods: PeriodRecord[];
}

/**
 * Años fiscales y cierre de periodos.
 *
 * El cierre es la pieza que da sentido a todo lo demás. Sin él, un ERP es un
 * registro de lo que alguien escribió por última vez; con él, es una
 * contabilidad: lo declarado deja de poder cambiar.
 */
export class PeriodUseCases {
  constructor(
    private readonly years: FiscalYearRepository,
    private readonly periods: PeriodRepository,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx): Promise<YearWithPeriods[]> {
    assertCan(ctx, 'accounting:period:read');
    const years = await this.years.list(tx);
    const out: YearWithPeriods[] = [];
    for (const year of years) {
      out.push({ year, periods: await this.periods.ofYear(tx, year.id) });
    }
    return out;
  }

  async get(ctx: RequestContext, tx: Tx, yearId: string): Promise<YearWithPeriods> {
    assertCan(ctx, 'accounting:period:read');
    const year = await this.years.byId(tx, yearId);
    if (!year) throw AppError.notFound('Año fiscal');
    return { year, periods: await this.periods.ofYear(tx, year.id) };
  }

  /**
   * Abre un año fiscal con sus doce meses y el periodo de ajustes.
   *
   * Año y periodos nacen juntos, en la misma transacción. Un año sin periodos
   * no sirve para nada —no se puede contabilizar en él— y dejarlo a medias haría
   * que el primer intento de emitir una factura fallara con "no hay periodo",
   * justo cuando alguien intenta cobrar.
   */
  async openYear(
    ctx: RequestContext,
    tx: Tx,
    year: number,
    withAdjustmentPeriod = true,
  ): Promise<YearWithPeriods> {
    assertCan(ctx, 'accounting:period:manage');

    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      throw AppError.validation(`"${year}" no es un año fiscal válido`);
    }

    const range = fiscalYearRange(year);
    const overlapping = await this.years.containing(tx, range.startDate);
    if (overlapping) {
      throw AppError.conflict(
        `El año ${year} se solapa con "${overlapping.name}" (${overlapping.startDate} a ${overlapping.endDate})`,
      );
    }

    const record: FiscalYearRecord = {
      id: newId(),
      organizationId: ctx.organizationId,
      name: String(year),
      startDate: range.startDate,
      endDate: range.endDate,
      status: 'OPEN',
      closedAt: null,
    };
    await this.years.create(tx, record);

    const periods: PeriodRecord[] = monthlyPeriods(year, withAdjustmentPeriod).map((p) => ({
      id: newId(),
      organizationId: ctx.organizationId,
      fiscalYearId: record.id,
      periodNo: p.periodNo,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      status: 'OPEN',
      closedAt: null,
    }));
    await this.periods.createMany(tx, periods);

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'fiscal_year',
      entityId: record.id,
      entityLabel: record.name,
      after: { desde: record.startDate, hasta: record.endDate, periodos: periods.length },
    });

    return { year: record, periods };
  }

  async closePeriod(ctx: RequestContext, tx: Tx, periodId: string): Promise<PeriodRecord> {
    assertCan(ctx, 'accounting:period:close');
    const period = await this.requirePeriod(tx, periodId);
    if (period.status === 'CLOSED') throw AppError.rule(`${period.name} ya está cerrado`);

    const siblings = await this.periods.ofYear(tx, period.fiscalYearId);
    assertClosableInOrder(siblings, period);

    await this.periods.setStatus(tx, periodId, 'CLOSED', actorMembershipId(ctx));
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'accounting_period',
      entityId: periodId,
      entityLabel: period.name,
      before: { estado: 'abierto' },
      after: { estado: 'cerrado', asientos: await this.periods.entryCount(tx, periodId) },
    });

    const updated = await this.periods.byId(tx, periodId);
    if (!updated) throw AppError.internal('El periodo no se pudo cerrar');
    return updated;
  }

  /**
   * Reabre un periodo.
   *
   * Es un permiso APARTE de cerrarlo, y no por simetría: cerrar es rutina de
   * fin de mes y reabrir es deshacer algo que ya se declaró. Quien pueda cerrar
   * no tiene por qué poder reabrir, y la auditoría deja constancia de quién lo
   * hizo.
   */
  async reopenPeriod(ctx: RequestContext, tx: Tx, periodId: string): Promise<PeriodRecord> {
    assertCan(ctx, 'accounting:period:reopen');
    const period = await this.requirePeriod(tx, periodId);
    if (period.status === 'OPEN') throw AppError.rule(`${period.name} ya está abierto`);

    const year = await this.years.byId(tx, period.fiscalYearId);
    if (year?.status === 'CLOSED') {
      throw AppError.rule(
        `El año ${year.name} está cerrado: reábrelo antes de tocar ${period.name}`,
      );
    }

    const siblings = await this.periods.ofYear(tx, period.fiscalYearId);
    assertReopenableInOrder(siblings, period);

    await this.periods.setStatus(tx, periodId, 'OPEN', null);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'accounting_period',
      entityId: periodId,
      entityLabel: period.name,
      before: { estado: 'cerrado' },
      after: { estado: 'abierto' },
    });

    const updated = await this.periods.byId(tx, periodId);
    if (!updated) throw AppError.internal('El periodo no se pudo reabrir');
    return updated;
  }

  /** Cerrar el año exige tener cerrados todos sus periodos. */
  async closeYear(ctx: RequestContext, tx: Tx, yearId: string): Promise<FiscalYearRecord> {
    assertCan(ctx, 'accounting:period:close');
    const year = await this.years.byId(tx, yearId);
    if (!year) throw AppError.notFound('Año fiscal');
    if (year.status === 'CLOSED') throw AppError.rule(`El año ${year.name} ya está cerrado`);

    const periods = await this.periods.ofYear(tx, yearId);
    const open = periods.filter((p) => p.status === 'OPEN');
    if (open.length > 0) {
      throw AppError.rule(
        `El año ${year.name} tiene ${open.length} periodo(s) sin cerrar: ` +
          open.map((p) => p.name).join(', '),
      );
    }

    await this.years.setStatus(tx, yearId, 'CLOSED', actorMembershipId(ctx));
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'fiscal_year',
      entityId: yearId,
      entityLabel: year.name,
      before: { estado: 'abierto' },
      after: { estado: 'cerrado' },
    });

    const updated = await this.years.byId(tx, yearId);
    if (!updated) throw AppError.internal('El año no se pudo cerrar');
    return updated;
  }

  async reopenYear(ctx: RequestContext, tx: Tx, yearId: string): Promise<FiscalYearRecord> {
    assertCan(ctx, 'accounting:period:reopen');
    const year = await this.years.byId(tx, yearId);
    if (!year) throw AppError.notFound('Año fiscal');
    if (year.status === 'OPEN') throw AppError.rule(`El año ${year.name} ya está abierto`);

    await this.years.setStatus(tx, yearId, 'OPEN', null);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'fiscal_year',
      entityId: yearId,
      entityLabel: year.name,
      before: { estado: 'cerrado' },
      after: { estado: 'abierto' },
    });
    const updated = await this.years.byId(tx, yearId);
    if (!updated) throw AppError.internal('El año no se pudo reabrir');
    return updated;
  }

  /**
   * Abre el año de una fecha si todavía no existe.
   *
   * Lo usa la contabilización automática: emitir la primera factura de enero no
   * debería fallar porque nadie se acordó de abrir el año, y abrirlo no decide
   * nada —los periodos nacen abiertos y el cierre sigue siendo un acto
   * deliberado—.
   */
  async ensureYearFor(ctx: RequestContext, tx: Tx, date: LocalDate): Promise<void> {
    const existing = await this.years.containing(tx, date);
    if (existing) return;
    await this.openYear(ctx, tx, Number(date.slice(0, 4)));
  }

  private async requirePeriod(tx: Tx, id: string): Promise<PeriodRecord> {
    const period = await this.periods.byId(tx, id);
    if (!period) throw AppError.notFound('Periodo contable');
    return period;
  }

  today(): LocalDate {
    return this.clock.now().toISOString().slice(0, 10);
  }
}
