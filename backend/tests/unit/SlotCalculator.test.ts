import { describe, expect, it } from 'vitest';
import { SlotCalculator } from '../../src/domain/services/SlotCalculator.js';
import { generateOccurrences } from '../../src/domain/services/RecurrenceGenerator.js';
import { addMonths } from '../../src/shared/dates.js';

const hours = [{ id: 'a', staffId: 's', weekday: 2, startTime: '09:00', endTime: '12:00' }]; // martes
const now = new Date(2026, 2, 9, 12, 0); // lunes al mediodía

describe('SlotCalculator', () => {
  it('genera franjas cada 30 min dentro del horario', () => {
    const slots = SlotCalculator.compute({ date: '2026-03-10', workingHours: hours, timeOff: [], busy: [], durationMinutes: 60, now });
    expect(slots.map((s) => s.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('no devuelve nada en días sin horario', () => {
    expect(SlotCalculator.compute({ date: '2026-03-11', workingHours: hours, timeOff: [], busy: [], durationMinutes: 60, now })).toEqual([]);
  });

  it('excluye reservas existentes y respeta el buffer', () => {
    const busy = [{ startAt: '2026-03-10T10:00', endAt: '2026-03-10T11:00' }];
    const wide = [{ ...hours[0], endTime: '13:00' }];
    const slots = SlotCalculator.compute({ date: '2026-03-10', workingHours: wide, timeOff: [], busy, durationMinutes: 60, bufferMinutes: 15, now });
    expect(slots.map((s) => s.time)).toEqual(['11:30', '12:00']);
  });

  it('excluye bloqueos (time off)', () => {
    const timeOff = [{ id: 't', staffId: 's', startAt: '2026-03-10T09:00', endAt: '2026-03-10T10:30', reason: null }];
    const slots = SlotCalculator.compute({ date: '2026-03-10', workingHours: hours, timeOff, busy: [], durationMinutes: 30, now });
    expect(slots.map((s) => s.time)).toEqual(['10:30', '11:00', '11:30']);
  });

  it('respeta la anticipación mínima respecto a "ahora"', () => {
    const today = new Date(2026, 2, 10, 9, 45);
    const slots = SlotCalculator.compute({ date: '2026-03-10', workingHours: hours, timeOff: [], busy: [], durationMinutes: 30, now: today, minLeadMinutes: 60 });
    expect(slots[0].time).toBe('11:00');
  });

  it('isAvailable valida un inicio concreto', () => {
    const base = { workingHours: hours, timeOff: [], busy: [], durationMinutes: 60, now };
    expect(SlotCalculator.isAvailable({ ...base, startAt: '2026-03-10T11:00' })).toBe(true);
    expect(SlotCalculator.isAvailable({ ...base, startAt: '2026-03-10T11:30' })).toBe(false);
  });
});

describe('RecurrenceGenerator', () => {
  it('semanal genera 4 ocurrencias por defecto', () => {
    expect(generateOccurrences('2026-03-10T10:00', 'WEEKLY')).toEqual([
      '2026-03-10T10:00', '2026-03-17T10:00', '2026-03-24T10:00', '2026-03-31T10:00',
    ]);
  });
  it('quincenal y mensual', () => {
    expect(generateOccurrences('2026-03-10T10:00', 'BIWEEKLY', 2)).toEqual(['2026-03-10T10:00', '2026-03-24T10:00']);
    expect(generateOccurrences('2026-01-31T10:00', 'MONTHLY', 3)).toEqual(['2026-01-31T10:00', '2026-02-28T10:00', '2026-03-31T10:00']);
  });
  it('ONCE ignora occurrences', () => {
    expect(generateOccurrences('2026-03-10T10:00', 'ONCE', 5)).toHaveLength(1);
  });
  it('addMonths ajusta fin de mes', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
});
