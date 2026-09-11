import { addDays, addMonths, datePart, timePart, type LocalDateTime } from '../../shared/dates.js';
import type { Frequency } from '../entities/Booking.js';

export const DEFAULT_OCCURRENCES: Record<Frequency, number> = {
  ONCE: 1,
  WEEKLY: 4,
  BIWEEKLY: 3,
  MONTHLY: 3,
};

export const MAX_OCCURRENCES = 12;

/** Genera las fechas de inicio de una serie recurrente. */
export const generateOccurrences = (
  firstStart: LocalDateTime,
  frequency: Frequency,
  occurrences = DEFAULT_OCCURRENCES[frequency],
): LocalDateTime[] => {
  const n = Math.max(1, Math.min(MAX_OCCURRENCES, occurrences));
  const date = datePart(firstStart);
  const time = timePart(firstStart);
  const out: LocalDateTime[] = [];
  for (let i = 0; i < n; i++) {
    let d = date;
    if (frequency === 'WEEKLY') d = addDays(date, 7 * i);
    else if (frequency === 'BIWEEKLY') d = addDays(date, 14 * i);
    else if (frequency === 'MONTHLY') d = addMonths(date, i);
    else if (i > 0) break;
    out.push(`${d}T${time}`);
  }
  return out;
};
