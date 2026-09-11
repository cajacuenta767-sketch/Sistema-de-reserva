import type { HHMM, LocalDateTime } from '../../shared/dates.js';

export interface Staff {
  id: string;
  userId: string;
  displayName: string;
  title: string;
  bio: string;
  avatarUrl: string | null;
  email: string;
  phone: string | null;
  isActive: boolean;
  ratingAvg: number;
  ratingCount: number;
  completedJobs: number;
  createdAt: string;
  updatedAt: string;
}

/** Bloque de horario semanal recurrente. weekday: 0=Dom … 6=Sáb */
export interface WorkingHours {
  id: string;
  staffId: string;
  weekday: number;
  startTime: HHMM;
  endTime: HHMM;
}

/** Bloqueo puntual (vacaciones, cita médica, etc.) */
export interface TimeOff {
  id: string;
  staffId: string;
  startAt: LocalDateTime;
  endAt: LocalDateTime;
  reason: string | null;
}

export interface StaffService {
  staffId: string;
  serviceId: string;
}
