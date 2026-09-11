/**
 * Convención temporal del sistema:
 *  - Fechas contables y documentales: `LocalDate` = 'YYYY-MM-DD'. Sin zona horaria:
 *    una factura del 3 de marzo lo es en cualquier parte del mundo.
 *  - Agenda (eventos, turnos): `LocalDateTime` = 'YYYY-MM-DDTHH:MM' en hora local del
 *    negocio. Comparable lexicográficamente, que es lo que hace baratas las consultas.
 *  - Auditoría (`createdAt`, `postedAt`): `timestamptz` / ISO UTC completo.
 */
export type LocalDate = string; // YYYY-MM-DD
export type LocalDateTime = string; // YYYY-MM-DDTHH:MM
export type HHMM = string; // HH:MM

const pad = (n: number): string => String(n).padStart(2, '0');

const nums = (s: string, sep: string): number[] => s.split(sep).map((p) => Number(p));

const at = (arr: number[], i: number): number => {
  const v = arr[i];
  if (v === undefined || Number.isNaN(v)) throw new Error(`Fecha inválida: falta el componente ${i}`);
  return v;
};

export const toLocalDate = (d: Date): LocalDate =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const toLocalDateTime = (d: Date): LocalDateTime =>
  `${toLocalDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const parseLocalDate = (s: LocalDate): Date => {
  const p = nums(s.slice(0, 10), '-');
  return new Date(at(p, 0), at(p, 1) - 1, at(p, 2), 0, 0, 0, 0);
};

export const parseLocalDateTime = (s: LocalDateTime): Date => {
  const [date, time] = s.split('T');
  if (date === undefined) throw new Error(`Fecha/hora inválida: ${s}`);
  const d = nums(date, '-');
  const t = time ? nums(time.slice(0, 5), ':') : [0, 0];
  return new Date(at(d, 0), at(d, 1) - 1, at(d, 2), at(t, 0), at(t, 1), 0, 0);
};

export const isLocalDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

export const hhmmToMinutes = (t: HHMM): number => {
  const p = nums(t, ':');
  return at(p, 0) * 60 + at(p, 1);
};

export const minutesToHHMM = (min: number): HHMM => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export const addDays = (date: LocalDate, days: number): LocalDate => {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
};

export const addMonths = (date: LocalDate, months: number): LocalDate => {
  const d = parseLocalDate(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toLocalDate(d);
};

export const addYears = (date: LocalDate, years: number): LocalDate => addMonths(date, years * 12);

export const addMinutes = (dt: LocalDateTime, minutes: number): LocalDateTime => {
  const d = parseLocalDateTime(dt);
  d.setMinutes(d.getMinutes() + minutes);
  return toLocalDateTime(d);
};

/** 0 = Domingo … 6 = Sábado (convención JS). */
export const weekdayOf = (date: LocalDate): number => parseLocalDate(date).getDay();

/** Lunes = 0 … Domingo = 6. La semana laboral colombiana empieza en lunes. */
export const isoWeekdayOf = (date: LocalDate): number => (weekdayOf(date) + 6) % 7;

export const datePart = (dt: LocalDateTime): LocalDate => dt.slice(0, 10);
export const timePart = (dt: LocalDateTime): HHMM => dt.slice(11, 16);

export const daysInMonth = (year: number, month1to12: number): number =>
  new Date(year, month1to12, 0).getDate();

export const diffMinutes = (a: LocalDateTime, b: LocalDateTime): number =>
  Math.round((parseLocalDateTime(a).getTime() - parseLocalDateTime(b).getTime()) / 60000);

export const diffDays = (a: LocalDate, b: LocalDate): number =>
  Math.round((parseLocalDate(a).getTime() - parseLocalDate(b).getTime()) / 86_400_000);

export const startOfMonth = (date: LocalDate): LocalDate => `${date.slice(0, 7)}-01`;

export const endOfMonth = (date: LocalDate): LocalDate => {
  const d = parseLocalDate(date);
  return toLocalDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

export const clampDate = (date: LocalDate, min: LocalDate, max: LocalDate): LocalDate =>
  date < min ? min : date > max ? max : date;

/** Rango [from, to] inclusivo, útil para filtros de periodo. */
export interface DateRange {
  from: LocalDate;
  to: LocalDate;
}

export const monthRange = (yyyymm: string): DateRange => ({
  from: `${yyyymm}-01`,
  to: endOfMonth(`${yyyymm}-01`),
});

export const rangeContains = (r: DateRange, date: LocalDate): boolean => date >= r.from && date <= r.to;

export const rangesOverlap = (a: DateRange, b: DateRange): boolean => a.from <= b.to && b.from <= a.to;
