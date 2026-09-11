import { format, parse } from 'date-fns';
import { es } from 'date-fns/locale';
import type { BookingStatus, Frequency } from '@/api/types';

export const money = (cents: number, currency = 'COP') =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);

export const parseLocal = (dt: string) => parse(dt.length === 10 ? `${dt}T00:00` : dt, "yyyy-MM-dd'T'HH:mm", new Date());
export const fmtDate = (dt: string, pattern = "EEEE d 'de' MMMM") => format(parseLocal(dt), pattern, { locale: es });
export const fmtDateShort = (dt: string) => format(parseLocal(dt), 'd MMM yyyy', { locale: es });
export const fmtTime = (dt: string) => dt.slice(11, 16);
export const fmtDateTime = (dt: string) => `${fmtDate(dt, "EEE d MMM")} · ${fmtTime(dt)}`;
export const toLocalDate = (d: Date) => format(d, 'yyyy-MM-dd');
export const toMonthKey = (d: Date) => format(d, 'yyyy-MM');
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: 'Pendiente', CONFIRMED: 'Confirmada', IN_PROGRESS: 'En curso', COMPLETED: 'Completada', CANCELLED: 'Cancelada', NO_SHOW: 'No asistió',
};
export const STATUS_STYLE: Record<BookingStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  CONFIRMED: 'bg-brand-100 text-brand-800',
  IN_PROGRESS: 'bg-sky-100 text-sky-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-ink-900/5 text-ink-500',
  NO_SHOW: 'bg-coral-100 text-coral-600',
};
export const FREQUENCY_LABEL: Record<Frequency, string> = { ONCE: 'Una vez', WEEKLY: 'Semanal', BIWEEKLY: 'Quincenal', MONTHLY: 'Mensual' };
export const FREQUENCY_HINT: Record<Frequency, string> = {
  ONCE: 'Una sola cita', WEEKLY: '4 citas, una por semana', BIWEEKLY: '3 citas, cada dos semanas', MONTHLY: '3 citas, una al mes',
};
export const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const WEEKDAYS_LONG = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
