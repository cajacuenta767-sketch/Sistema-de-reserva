import type { LocalDate } from '../../shared/dates.js';

export interface WaitlistEntry {
  id: string;
  clientId: string;
  staffId: string | null;
  serviceId: string;
  date: LocalDate;
  notifiedAt: string | null;
  createdAt: string;
}
