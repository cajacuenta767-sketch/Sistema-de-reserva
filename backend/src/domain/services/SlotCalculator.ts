import {
  addMinutes,
  hhmmToMinutes,
  minutesToHHMM,
  parseLocalDateTime,
  toLocalDateTime,
  weekdayOf,
  type LocalDate,
  type LocalDateTime,
} from '../../shared/dates.js';
import type { TimeOff, WorkingHours } from '../entities/Staff.js';
import { overlaps } from '../entities/Booking.js';

export interface BusyInterval {
  startAt: LocalDateTime;
  endAt: LocalDateTime;
}

export interface Slot {
  startAt: LocalDateTime;
  endAt: LocalDateTime;
  time: string; // HH:MM
}

export interface SlotCalculationInput {
  date: LocalDate;
  workingHours: WorkingHours[]; // de cualquier día; se filtra por weekday
  timeOff: TimeOff[];
  busy: BusyInterval[]; // reservas activas del profesional
  durationMinutes: number;
  bufferMinutes?: number;
  stepMinutes?: number; // granularidad de inicio (default 30)
  now: Date;
  minLeadMinutes?: number; // anticipación mínima (default 60)
  ignoreBookingId?: string; // no usado aquí; los repos filtran
}

/**
 * Servicio de dominio puro: dado el horario semanal, bloqueos y reservas del
 * profesional, produce las franjas disponibles para una fecha.
 */
export class SlotCalculator {
  static compute(input: SlotCalculationInput): Slot[] {
    const {
      date,
      workingHours,
      timeOff,
      busy,
      durationMinutes,
      bufferMinutes = 0,
      stepMinutes = 30,
      now,
      minLeadMinutes = 60,
    } = input;

    const weekday = weekdayOf(date);
    const ranges = workingHours
      .filter((w) => w.weekday === weekday)
      .sort((a, b) => hhmmToMinutes(a.startTime) - hhmmToMinutes(b.startTime));
    if (ranges.length === 0) return [];

    const earliest = toLocalDateTime(new Date(now.getTime() + minLeadMinutes * 60_000));
    const slots: Slot[] = [];

    for (const range of ranges) {
      const startMin = hhmmToMinutes(range.startTime);
      const endMin = hhmmToMinutes(range.endTime);
      for (let m = startMin; m + durationMinutes <= endMin; m += stepMinutes) {
        const startAt: LocalDateTime = `${date}T${minutesToHHMM(m)}`;
        const endAt = addMinutes(startAt, durationMinutes);
        const endWithBuffer = addMinutes(startAt, durationMinutes + bufferMinutes);
        if (startAt < earliest) continue;
        // El buffer aplica tras cada servicio (el nuevo y los ya reservados).
        const clashesBooking = busy.some((b) => overlaps(startAt, endWithBuffer, b.startAt, addMinutes(b.endAt, bufferMinutes)));
        if (clashesBooking) continue;
        const clashesOff = timeOff.some((t) => overlaps(startAt, endAt, t.startAt, t.endAt));
        if (clashesOff) continue;
        slots.push({ startAt, endAt, time: minutesToHHMM(m) });
      }
    }
    return slots;
  }

  /** Valida que un intervalo concreto cabe dentro del horario y no choca. */
  static isAvailable(input: Omit<SlotCalculationInput, 'date' | 'stepMinutes'> & { startAt: LocalDateTime }): boolean {
    const date = input.startAt.slice(0, 10);
    const time = input.startAt.slice(11, 16);
    const stepped = SlotCalculator.compute({ ...input, date, stepMinutes: 5 });
    return stepped.some((s) => s.time === time);
  }
}

export const isPast = (dt: LocalDateTime, now: Date) => parseLocalDateTime(dt).getTime() < now.getTime();
