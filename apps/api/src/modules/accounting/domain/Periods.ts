import { AppError } from '@erp/core';
import type { LocalDate } from '@erp/core';

/**
 * Años fiscales y periodos.
 *
 * En Colombia el año fiscal es el calendario, sin excepciones para el impuesto
 * de renta, así que la generación es mecánica. Lo que no es mecánico es el
 * CIERRE, y es justo lo que el sistema de referencia no tiene: sin él,
 * cualquiera puede modificar una factura de un año ya declarado y el balance
 * que se presentó a la DIAN deja de ser el que dice el sistema.
 */

export type PeriodStatus = 'OPEN' | 'CLOSED';

export interface PeriodSpec {
  periodNo: number;
  name: string;
  startDate: LocalDate;
  endDate: LocalDate;
}

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const lastDayOf = (year: number, month1to12: number): number =>
  new Date(Date.UTC(year, month1to12, 0)).getUTCDate();

/**
 * Los doce meses más, opcionalmente, un periodo 13 de ajustes.
 *
 * El periodo 13 no es un mes: es un cajón fechado el 31 de diciembre donde el
 * contador mete los ajustes del cierre. Sin él, esos ajustes se mezclan con las
 * operaciones de diciembre y deja de poderse contestar "¿cuánto vendimos en
 * diciembre?" sin restar a mano las provisiones de fin de año.
 */
export const monthlyPeriods = (year: number, withAdjustmentPeriod = true): PeriodSpec[] => {
  const periods: PeriodSpec[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, '0');
    periods.push({
      periodNo: m,
      name: `${MONTHS[m - 1]} ${year}`,
      startDate: `${year}-${mm}-01`,
      endDate: `${year}-${mm}-${String(lastDayOf(year, m)).padStart(2, '0')}`,
    });
  }
  if (withAdjustmentPeriod) {
    periods.push({
      periodNo: 13,
      name: `Ajustes ${year}`,
      startDate: `${year}-12-31`,
      endDate: `${year}-12-31`,
    });
  }
  return periods;
};

export const fiscalYearRange = (year: number): { startDate: LocalDate; endDate: LocalDate } => ({
  startDate: `${year}-01-01`,
  endDate: `${year}-12-31`,
});

export interface PeriodLike {
  id: string;
  periodNo: number;
  name: string;
  startDate: LocalDate;
  endDate: LocalDate;
  status: PeriodStatus;
}

/**
 * Periodo al que pertenece una fecha.
 *
 * Cuando dos periodos comparten fecha —el 31 de diciembre lo tienen diciembre y
 * el de ajustes— gana el de número más bajo: una operación normal del 31 es de
 * diciembre. Quien quiera contabilizar en ajustes lo elige a mano, que es
 * exactamente cuándo debe hacerse a mano.
 */
export const periodContaining = (
  periods: readonly PeriodLike[],
  date: LocalDate,
): PeriodLike | null =>
  [...periods]
    .filter((p) => date >= p.startDate && date <= p.endDate)
    .sort((a, b) => a.periodNo - b.periodNo)[0] ?? null;

export const requirePeriodFor = (periods: readonly PeriodLike[], date: LocalDate): PeriodLike => {
  const period = periodContaining(periods, date);
  if (!period) {
    throw AppError.rule(
      `No hay un periodo contable que contenga el ${date}. ` +
        'Abre el año fiscal correspondiente antes de contabilizar.',
    );
  }
  return period;
};

export const assertPeriodOpen = (period: PeriodLike): void => {
  if (period.status === 'CLOSED') throw AppError.periodClosed(period.name);
};

/**
 * Un periodo solo se cierra si los anteriores del año ya están cerrados.
 *
 * Cerrar marzo dejando febrero abierto da una falsa sensación de control: las
 * cifras de marzo pueden cambiar mañana, porque un asiento de febrero arrastra
 * saldos a marzo. El orden no es burocracia, es lo que hace que "cerrado"
 * signifique algo.
 */
export const assertClosableInOrder = (
  periods: readonly PeriodLike[],
  target: PeriodLike,
): void => {
  const pending = periods
    .filter((p) => p.periodNo < target.periodNo && p.status === 'OPEN')
    .sort((a, b) => a.periodNo - b.periodNo);
  const first = pending[0];
  if (first) {
    throw AppError.rule(
      `No se puede cerrar ${target.name} con ${first.name} todavía abierto. ` +
        'Los periodos se cierran en orden.',
    );
  }
};

/** Reabrir salta al revés: si abril está abierto, marzo puede reabrirse. */
export const assertReopenableInOrder = (
  periods: readonly PeriodLike[],
  target: PeriodLike,
): void => {
  const later = periods
    .filter((p) => p.periodNo > target.periodNo && p.status === 'CLOSED')
    .sort((a, b) => b.periodNo - a.periodNo);
  const last = later[0];
  if (last) {
    throw AppError.rule(
      `No se puede reabrir ${target.name} mientras ${last.name} siga cerrado. ` +
        'Reabre primero los periodos posteriores.',
    );
  }
};
