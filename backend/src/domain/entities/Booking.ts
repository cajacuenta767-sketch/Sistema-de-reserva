import type { LocalDateTime } from '../../shared/dates.js';

export type BookingStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export type Frequency = 'ONCE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export const FREQUENCIES: Frequency[] = ['ONCE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'];

/** Transiciones válidas de estado */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const ACTIVE_STATUSES: BookingStatus[] = ['PENDING', 'CONFIRMED', 'IN_PROGRESS'];

export interface Booking {
  id: string;
  code: string;
  /** Agrupa las ocurrencias de una reserva recurrente */
  seriesId: string | null;
  seriesIndex: number;
  frequency: Frequency;
  clientId: string;
  staffId: string;
  serviceId: string;
  startAt: LocalDateTime;
  endAt: LocalDateTime;
  status: BookingStatus;
  priceCents: number;
  discountCents: number;
  totalCents: number;
  couponCode: string | null;
  notes: string | null;
  address: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export const canTransition = (from: BookingStatus, to: BookingStatus) =>
  BOOKING_TRANSITIONS[from].includes(to);

export const isActiveBooking = (b: Pick<Booking, 'status'>) => ACTIVE_STATUSES.includes(b.status);

export const overlaps = (
  aStart: LocalDateTime,
  aEnd: LocalDateTime,
  bStart: LocalDateTime,
  bEnd: LocalDateTime,
) => aStart < bEnd && bStart < aEnd;
