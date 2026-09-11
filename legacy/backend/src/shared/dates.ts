/**
 * Convención temporal del sistema:
 *  - Las fechas/horas de agenda se manejan como "hora local del negocio" (sin zona),
 *    en formato ISO corto `YYYY-MM-DDTHH:MM`. Se comparan lexicográficamente.
 *  - Las marcas de auditoría (createdAt, etc.) sí son ISO UTC completas.
 */
export type LocalDate = string; // YYYY-MM-DD
export type LocalDateTime = string; // YYYY-MM-DDTHH:MM
export type HHMM = string; // HH:MM

const pad = (n: number) => String(n).padStart(2, '0');

export const toLocalDate = (d: Date): LocalDate =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const toLocalDateTime = (d: Date): LocalDateTime =>
  `${toLocalDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const parseLocalDate = (s: LocalDate): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

export const parseLocalDateTime = (s: LocalDateTime): Date => {
  const [date, time] = s.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time ?? '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
};

export const hhmmToMinutes = (t: HHMM): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
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

export const addMinutes = (dt: LocalDateTime, minutes: number): LocalDateTime => {
  const d = parseLocalDateTime(dt);
  d.setMinutes(d.getMinutes() + minutes);
  return toLocalDateTime(d);
};

/** 0 = Domingo … 6 = Sábado (convención JS) */
export const weekdayOf = (date: LocalDate): number => parseLocalDate(date).getDay();

export const datePart = (dt: LocalDateTime): LocalDate => dt.slice(0, 10);
export const timePart = (dt: LocalDateTime): HHMM => dt.slice(11, 16);

export const daysInMonth = (year: number, month1to12: number) => new Date(year, month1to12, 0).getDate();

export const diffMinutes = (a: LocalDateTime, b: LocalDateTime): number =>
  Math.round((parseLocalDateTime(a).getTime() - parseLocalDateTime(b).getTime()) / 60000);
