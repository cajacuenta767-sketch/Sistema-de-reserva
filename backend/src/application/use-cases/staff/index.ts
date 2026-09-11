import { AppError } from '../../../shared/AppError.js';
import type { Clock } from '../../../shared/Clock.js';
import { addDays, hhmmToMinutes, toLocalDate, daysInMonth, type LocalDate } from '../../../shared/dates.js';
import { newId } from '../../../shared/id.js';
import type { Staff, TimeOff, WorkingHours } from '../../../domain/entities/Staff.js';
import type { Role } from '../../../domain/entities/User.js';
import { SlotCalculator, type Slot } from '../../../domain/services/SlotCalculator.js';
import type {
  BookingRepository,
  PasswordHasher,
  ServiceRepository,
  StaffRepository,
  UserRepository,
} from '../../ports/index.js';

export interface StaffPublic extends Staff {
  serviceIds: string[];
}

export interface CreateStaffInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  title: string;
  bio?: string;
  avatarUrl?: string | null;
  phone?: string | null;
  serviceIds?: string[];
  workingHours?: Omit<WorkingHours, 'id' | 'staffId'>[];
}

export const DEFAULT_WORKING_HOURS: Omit<WorkingHours, 'id' | 'staffId'>[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startTime: '09:00',
  endTime: '18:00',
}));

export class StaffUseCases {
  constructor(
    private readonly staff: StaffRepository,
    private readonly users: UserRepository,
    private readonly services: ServiceRepository,
    private readonly bookings: BookingRepository,
    private readonly hasher: PasswordHasher,
    private readonly clock: Clock,
  ) {}

  private async withServices(s: Staff): Promise<StaffPublic> {
    return { ...s, serviceIds: await this.staff.serviceIdsOf(s.id) };
  }

  async list(opts?: { serviceId?: string; includeInactive?: boolean; availableOn?: LocalDate }) {
    const list = await this.staff.list({ serviceId: opts?.serviceId, includeInactive: opts?.includeInactive });
    const enriched = await Promise.all(list.map((s) => this.withServices(s)));
    if (!opts?.availableOn) return enriched;
    const service = opts.serviceId ? await this.services.findById(opts.serviceId) : null;
    const duration = service?.durationMinutes ?? 30;
    const buffer = service?.bufferMinutes ?? 0;
    const result: StaffPublic[] = [];
    for (const s of enriched) {
      const slots = await this.slotsFor(s.id, opts.availableOn, duration, buffer);
      if (slots.length > 0) result.push(s);
    }
    return result;
  }

  async get(id: string) {
    const s = await this.staff.findById(id);
    if (!s) throw AppError.notFound('Profesional');
    return this.withServices(s);
  }

  async getByUser(userId: string) {
    const s = await this.staff.findByUserId(userId);
    if (!s) throw AppError.notFound('Perfil de profesional');
    return this.withServices(s);
  }

  async create(input: CreateStaffInput) {
    const email = input.email.trim().toLowerCase();
    if (await this.users.findByEmail(email)) throw AppError.conflict('Ya existe una cuenta con este correo');
    const now = this.clock.now().toISOString();
    const role: Role = 'STAFF';
    const userId = newId();
    await this.users.save({
      id: userId,
      email,
      passwordHash: await this.hasher.hash(input.password),
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone ?? null,
      role,
      address: null,
      city: null,
      createdAt: now,
      updatedAt: now,
    });
    const s: Staff = {
      id: newId(),
      userId,
      displayName: input.displayName ?? `${input.firstName} ${input.lastName}`,
      title: input.title,
      bio: input.bio ?? '',
      avatarUrl: input.avatarUrl ?? null,
      email,
      phone: input.phone ?? null,
      isActive: true,
      ratingAvg: 0,
      ratingCount: 0,
      completedJobs: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.staff.save(s);
    if (input.serviceIds) await this.staff.setServices(s.id, input.serviceIds);
    await this.staff.setWorkingHours(s.id, input.workingHours ?? DEFAULT_WORKING_HOURS);
    return this.withServices(s);
  }

  async update(id: string, patch: Partial<Pick<Staff, 'displayName' | 'title' | 'bio' | 'avatarUrl' | 'phone' | 'isActive'>> & { serviceIds?: string[] }) {
    const s = await this.staff.findById(id);
    if (!s) throw AppError.notFound('Profesional');
    const { serviceIds, ...rest } = patch;
    const updated: Staff = { ...s, ...rest, id, updatedAt: this.clock.now().toISOString() };
    await this.staff.update(updated);
    if (serviceIds) await this.staff.setServices(id, serviceIds);
    return this.withServices(updated);
  }

  async remove(id: string) {
    if (!(await this.staff.findById(id))) throw AppError.notFound('Profesional');
    await this.staff.delete(id);
  }

  workingHours(staffId: string) {
    return this.staff.workingHours(staffId);
  }

  async setWorkingHours(staffId: string, hours: Omit<WorkingHours, 'id' | 'staffId'>[]) {
    if (!(await this.staff.findById(staffId))) throw AppError.notFound('Profesional');
    for (const h of hours) {
      if (h.weekday < 0 || h.weekday > 6) throw AppError.validation('weekday debe estar entre 0 y 6');
      if (hhmmToMinutes(h.startTime) >= hhmmToMinutes(h.endTime))
        throw AppError.validation(`Rango inválido ${h.startTime}-${h.endTime}`);
    }
    return this.staff.setWorkingHours(staffId, hours);
  }

  timeOff(staffId: string) {
    return this.staff.timeOff(staffId);
  }

  async addTimeOff(staffId: string, input: Omit<TimeOff, 'id' | 'staffId'>) {
    if (!(await this.staff.findById(staffId))) throw AppError.notFound('Profesional');
    if (input.startAt >= input.endAt) throw AppError.validation('El bloqueo debe terminar después de empezar');
    const t: TimeOff = { id: newId(), staffId, ...input };
    await this.staff.addTimeOff(t);
    return t;
  }

  removeTimeOff(id: string) {
    return this.staff.removeTimeOff(id);
  }

  /** Franjas disponibles de un profesional para un servicio en una fecha. */
  async slotsFor(staffId: string, date: LocalDate, durationMinutes: number, bufferMinutes: number, excludeBookingId?: string): Promise<Slot[]> {
    const [hours, off, busy] = await Promise.all([
      this.staff.workingHours(staffId),
      this.staff.timeOff(staffId, `${date}T00:00`, `${date}T23:59`),
      this.bookings.activeForStaffBetween(staffId, `${date}T00:00`, `${date}T23:59`, excludeBookingId),
    ]);
    return SlotCalculator.compute({
      date,
      workingHours: hours,
      timeOff: off,
      busy: busy.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
      durationMinutes,
      bufferMinutes,
      now: this.clock.now(),
    });
  }

  async availability(staffId: string, serviceId: string, date: LocalDate) {
    await this.get(staffId);
    const service = await this.services.findById(serviceId);
    if (!service) throw AppError.notFound('Servicio');
    const slots = await this.slotsFor(staffId, date, service.durationMinutes, service.bufferMinutes);
    return { staffId, serviceId, date, slots };
  }

  /** Resumen mensual: por cada día, cuántas franjas hay (para pintar el calendario). */
  async monthAvailability(staffId: string, serviceId: string, month: string /* YYYY-MM */) {
    await this.get(staffId);
    const service = await this.services.findById(serviceId);
    if (!service) throw AppError.notFound('Servicio');
    const [y, m] = month.split('-').map(Number);
    const today = toLocalDate(this.clock.now());
    const days: { date: LocalDate; slots: number }[] = [];
    const total = daysInMonth(y, m);
    for (let d = 1; d <= total; d++) {
      const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (date < today) {
        days.push({ date, slots: 0 });
        continue;
      }
      const slots = await this.slotsFor(staffId, date, service.durationMinutes, service.bufferMinutes);
      days.push({ date, slots: slots.length });
    }
    return { staffId, serviceId, month, days };
  }

  /** Primer día con disponibilidad a partir de hoy (útil para "próxima cita"). */
  async nextAvailableDate(staffId: string, serviceId: string, horizonDays = 30) {
    const service = await this.services.findById(serviceId);
    if (!service) throw AppError.notFound('Servicio');
    let date = toLocalDate(this.clock.now());
    for (let i = 0; i < horizonDays; i++) {
      const slots = await this.slotsFor(staffId, date, service.durationMinutes, service.bufferMinutes);
      if (slots.length) return { date, firstSlot: slots[0] };
      date = addDays(date, 1);
    }
    return null;
  }
}
