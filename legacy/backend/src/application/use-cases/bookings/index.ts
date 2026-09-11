import { AppError } from '../../../shared/AppError.js';
import type { Clock } from '../../../shared/Clock.js';
import { addMinutes, diffMinutes, toLocalDateTime, type LocalDateTime } from '../../../shared/dates.js';
import { confirmationCode, newId } from '../../../shared/id.js';
import {
  canTransition,
  isActiveBooking,
  type Booking,
  type BookingStatus,
  type Frequency,
} from '../../../domain/entities/Booking.js';
import { computeDiscount } from '../../../domain/entities/Coupon.js';
import { generateOccurrences } from '../../../domain/services/RecurrenceGenerator.js';
import { SlotCalculator, isPast } from '../../../domain/services/SlotCalculator.js';
import type { Role } from '../../../domain/entities/User.js';
import type {
  BookingFilters,
  BookingRepository,
  CouponRepository,
  ServiceRepository,
  StaffRepository,
  UserRepository,
  WaitlistRepository,
} from '../../ports/index.js';
import type { NotificationService } from '../../services/NotificationService.js';

export interface Actor {
  id: string;
  role: Role;
}

export interface CreateBookingInput {
  clientId: string;
  staffId: string;
  serviceId: string;
  startAt: LocalDateTime;
  frequency?: Frequency;
  occurrences?: number;
  couponCode?: string | null;
  notes?: string | null;
  address?: string | null;
}

export interface BookingPolicy {
  /** Horas mínimas de antelación para cancelar/reprogramar sin restricción */
  cancelLeadHours: number;
  minLeadMinutes: number;
}

export const DEFAULT_POLICY: BookingPolicy = { cancelLeadHours: 2, minLeadMinutes: 60 };

const fmt = (dt: LocalDateTime) => dt.replace('T', ' ');

export class BookingUseCases {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly staff: StaffRepository,
    private readonly services: ServiceRepository,
    private readonly users: UserRepository,
    private readonly coupons: CouponRepository,
    private readonly waitlist: WaitlistRepository,
    private readonly notifier: NotificationService,
    private readonly clock: Clock,
    private readonly policy: BookingPolicy = DEFAULT_POLICY,
  ) {}

  // ---------- helpers ----------

  private async assertSlotFree(staffId: string, startAt: LocalDateTime, duration: number, buffer: number, excludeId?: string) {
    const date = startAt.slice(0, 10);
    const [hours, off, busy] = await Promise.all([
      this.staff.workingHours(staffId),
      this.staff.timeOff(staffId, `${date}T00:00`, `${date}T23:59`),
      this.bookings.activeForStaffBetween(staffId, `${date}T00:00`, `${date}T23:59`, excludeId),
    ]);
    const ok = SlotCalculator.isAvailable({
      startAt,
      workingHours: hours,
      timeOff: off,
      busy: busy.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
      durationMinutes: duration,
      bufferMinutes: buffer,
      now: this.clock.now(),
      minLeadMinutes: this.policy.minLeadMinutes,
    });
    if (!ok) throw AppError.conflict(`La franja ${fmt(startAt)} no está disponible`, { startAt });
  }

  private canAccess(actor: Actor, b: Booking, staffIdOfActor: string | null) {
    if (actor.role === 'ADMIN') return true;
    if (actor.role === 'STAFF' && staffIdOfActor === b.staffId) return true;
    return b.clientId === actor.id;
  }

  private async staffIdFor(actor: Actor) {
    if (actor.role !== 'STAFF') return null;
    return (await this.staff.findByUserId(actor.id))?.id ?? null;
  }

  private async getAuthorized(actor: Actor, id: string) {
    const b = await this.bookings.findById(id);
    if (!b) throw AppError.notFound('Reserva');
    if (!this.canAccess(actor, b, await this.staffIdFor(actor))) throw AppError.forbidden();
    return b;
  }

  // ---------- queries ----------

  async get(actor: Actor, id: string) {
    return this.getAuthorized(actor, id);
  }

  async getByCode(code: string) {
    const b = await this.bookings.findByCode(code.toUpperCase());
    if (!b) throw AppError.notFound('Reserva');
    return b;
  }

  async list(actor: Actor, filters: BookingFilters) {
    const f: BookingFilters = { ...filters };
    if (actor.role === 'CLIENT') f.clientId = actor.id;
    if (actor.role === 'STAFF') {
      const sid = await this.staffIdFor(actor);
      if (!sid) return { items: [], total: 0 };
      f.staffId = sid;
    }
    const [items, total] = await Promise.all([this.bookings.list(f), this.bookings.count(f)]);
    return { items, total };
  }

  // ---------- pricing ----------

  async quote(serviceId: string, couponCode?: string | null, occurrences = 1) {
    const service = await this.services.findById(serviceId);
    if (!service) throw AppError.notFound('Servicio');
    const price = service.priceCents;
    let discount = 0;
    let coupon = null;
    if (couponCode) {
      coupon = await this.coupons.findByCode(couponCode.trim().toUpperCase());
      const now = this.clock.now().toISOString();
      if (!coupon || !coupon.isActive) throw AppError.rule('Cupón inválido');
      if (coupon.validFrom && coupon.validFrom > now) throw AppError.rule('El cupón aún no está vigente');
      if (coupon.validUntil && coupon.validUntil < now) throw AppError.rule('El cupón ha expirado');
      if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) throw AppError.rule('El cupón agotó sus usos');
      if (price < coupon.minAmountCents) throw AppError.rule('El servicio no alcanza el mínimo del cupón');
      discount = computeDiscount(coupon, price);
    }
    const perBooking = { priceCents: price, discountCents: discount, totalCents: price - discount };
    return {
      ...perBooking,
      occurrences,
      grandTotalCents: perBooking.totalCents * occurrences,
      currency: service.currency,
      coupon: coupon ? { code: coupon.code, description: coupon.description } : null,
    };
  }

  // ---------- commands ----------

  async create(input: CreateBookingInput): Promise<Booking[]> {
    const [service, staff, client] = await Promise.all([
      this.services.findById(input.serviceId),
      this.staff.findById(input.staffId),
      this.users.findById(input.clientId),
    ]);
    if (!service || !service.isActive) throw AppError.notFound('Servicio');
    if (!staff || !staff.isActive) throw AppError.notFound('Profesional');
    if (!client) throw AppError.notFound('Cliente');
    const offered = await this.staff.serviceIdsOf(staff.id);
    if (offered.length && !offered.includes(service.id)) throw AppError.rule('El profesional no ofrece este servicio');
    if (isPast(input.startAt, this.clock.now())) throw AppError.rule('No se puede reservar en el pasado');

    const frequency = input.frequency ?? 'ONCE';
    const starts = generateOccurrences(input.startAt, frequency, input.occurrences);
    const quote = await this.quote(service.id, input.couponCode, starts.length);

    // Validar todas las ocurrencias antes de persistir (todo o nada)
    const unavailable: LocalDateTime[] = [];
    for (const s of starts) {
      try {
        await this.assertSlotFree(staff.id, s, service.durationMinutes, service.bufferMinutes);
      } catch (e) {
        if (e instanceof AppError && e.code === 'CONFLICT') unavailable.push(s);
        else throw e;
      }
    }
    if (unavailable.length) {
      throw AppError.conflict('Algunas fechas de la serie no están disponibles', { unavailable });
    }

    const now = this.clock.now().toISOString();
    const seriesId = starts.length > 1 ? newId() : null;
    const bookings: Booking[] = starts.map((startAt, i) => ({
      id: newId(),
      code: confirmationCode(),
      seriesId,
      seriesIndex: i,
      frequency,
      clientId: client.id,
      staffId: staff.id,
      serviceId: service.id,
      startAt,
      endAt: addMinutes(startAt, service.durationMinutes),
      status: 'CONFIRMED',
      priceCents: quote.priceCents,
      discountCents: quote.discountCents,
      totalCents: quote.totalCents,
      couponCode: quote.coupon?.code ?? null,
      notes: input.notes ?? null,
      address: input.address ?? client.address,
      cancelledAt: null,
      cancelReason: null,
      createdAt: now,
      updatedAt: now,
    }));

    await this.bookings.saveMany(bookings);
    if (quote.coupon) {
      const c = await this.coupons.findByCode(quote.coupon.code);
      if (c) await this.coupons.incrementUsage(c.id, 1);
    }

    const first = bookings[0];
    const serieTxt = bookings.length > 1 ? ` (serie de ${bookings.length} citas)` : '';
    await this.notifier.notify(
      client.id,
      'BOOKING_CREATED',
      `Reserva confirmada · ${first.code}`,
      `Tu cita de ${service.name} con ${staff.displayName} quedó agendada para ${fmt(first.startAt)}${serieTxt}.`,
      { bookingId: first.id, code: first.code },
    );
    await this.notifier.notify(
      staff.userId,
      'BOOKING_CREATED',
      'Nueva reserva',
      `${client.firstName} ${client.lastName} reservó ${service.name} el ${fmt(first.startAt)}${serieTxt}.`,
      { bookingId: first.id },
    );
    return bookings;
  }

  async cancel(actor: Actor, id: string, reason?: string, wholeSeries = false) {
    const b = await this.getAuthorized(actor, id);
    if (!isActiveBooking(b)) throw AppError.rule('La reserva ya no está activa');
    if (actor.role === 'CLIENT') {
      const lead = diffMinutes(b.startAt, toLocalDateTime(this.clock.now()));
      if (lead < this.policy.cancelLeadHours * 60)
        throw AppError.rule(`Solo puedes cancelar con al menos ${this.policy.cancelLeadHours}h de antelación`);
    }
    const targets = wholeSeries && b.seriesId
      ? (await this.bookings.list({ seriesId: b.seriesId, status: ['PENDING', 'CONFIRMED'] })).filter((x) => x.startAt >= b.startAt)
      : [b];
    const now = this.clock.now().toISOString();
    const cancelled: Booking[] = [];
    for (const t of targets) {
      if (!canTransition(t.status, 'CANCELLED')) continue;
      const updated: Booking = { ...t, status: 'CANCELLED', cancelledAt: now, cancelReason: reason ?? null, updatedAt: now };
      await this.bookings.update(updated);
      cancelled.push(updated);
    }
    const staff = await this.staff.findById(b.staffId);
    const msg = cancelled.length > 1 ? `Se cancelaron ${cancelled.length} citas de la serie.` : `La cita del ${fmt(b.startAt)} fue cancelada.`;
    await this.notifier.notify(b.clientId, 'BOOKING_CANCELLED', `Reserva cancelada · ${b.code}`, msg, { bookingId: b.id });
    if (staff) await this.notifier.notify(staff.userId, 'BOOKING_CANCELLED', 'Reserva cancelada', msg, { bookingId: b.id });
    await this.notifyWaitlist(b);
    return cancelled;
  }

  async reschedule(actor: Actor, id: string, newStartAt: LocalDateTime) {
    const b = await this.getAuthorized(actor, id);
    if (!isActiveBooking(b) || b.status === 'IN_PROGRESS') throw AppError.rule('La reserva no se puede reprogramar');
    if (actor.role === 'CLIENT') {
      const lead = diffMinutes(b.startAt, toLocalDateTime(this.clock.now()));
      if (lead < this.policy.cancelLeadHours * 60)
        throw AppError.rule(`Solo puedes reprogramar con al menos ${this.policy.cancelLeadHours}h de antelación`);
    }
    const service = await this.services.findById(b.serviceId);
    if (!service) throw AppError.notFound('Servicio');
    await this.assertSlotFree(b.staffId, newStartAt, service.durationMinutes, service.bufferMinutes, b.id);
    const now = this.clock.now().toISOString();
    const updated: Booking = {
      ...b,
      startAt: newStartAt,
      endAt: addMinutes(newStartAt, service.durationMinutes),
      status: 'CONFIRMED',
      updatedAt: now,
    };
    await this.bookings.update(updated);
    await this.notifier.notify(
      b.clientId,
      'BOOKING_RESCHEDULED',
      `Reserva reprogramada · ${b.code}`,
      `Tu cita pasó del ${fmt(b.startAt)} al ${fmt(newStartAt)}.`,
      { bookingId: b.id },
    );
    await this.notifyWaitlist(b);
    return updated;
  }

  /** Cambio de estado operativo (staff/admin): confirmar, iniciar, completar, no-show. */
  async changeStatus(actor: Actor, id: string, status: BookingStatus) {
    if (actor.role === 'CLIENT') throw AppError.forbidden();
    const b = await this.getAuthorized(actor, id);
    if (!canTransition(b.status, status)) throw AppError.rule(`Transición inválida ${b.status} → ${status}`);
    const now = this.clock.now().toISOString();
    const updated: Booking = { ...b, status, updatedAt: now, cancelledAt: status === 'CANCELLED' ? now : b.cancelledAt };
    await this.bookings.update(updated);
    if (status === 'COMPLETED') {
      const staff = await this.staff.findById(b.staffId);
      if (staff) await this.staff.update({ ...staff, completedJobs: staff.completedJobs + 1, updatedAt: now });
      await this.notifier.notify(
        b.clientId,
        'BOOKING_COMPLETED',
        '¿Qué tal estuvo tu servicio?',
        'Tu cita fue completada. Cuéntanos tu experiencia dejando una reseña.',
        { bookingId: b.id },
      );
    } else if (status === 'CONFIRMED') {
      await this.notifier.notify(b.clientId, 'BOOKING_CONFIRMED', `Reserva confirmada · ${b.code}`, `Tu cita del ${fmt(b.startAt)} fue confirmada.`, { bookingId: b.id });
    } else if (status === 'CANCELLED') {
      await this.notifier.notify(b.clientId, 'BOOKING_CANCELLED', `Reserva cancelada · ${b.code}`, `Tu cita del ${fmt(b.startAt)} fue cancelada por el negocio.`, { bookingId: b.id });
      await this.notifyWaitlist(b);
    }
    return updated;
  }

  /** Envía recordatorios de las citas que empiezan dentro de `withinHours`. */
  async sendReminders(withinHours = 24) {
    const now = this.clock.now();
    const from = toLocalDateTime(now);
    const to = toLocalDateTime(new Date(now.getTime() + withinHours * 3_600_000));
    const upcoming = await this.bookings.list({ status: ['CONFIRMED'], from, to, limit: 500 });
    let sent = 0;
    for (const b of upcoming) {
      const service = await this.services.findById(b.serviceId);
      await this.notifier.notify(
        b.clientId,
        'BOOKING_REMINDER',
        'Recordatorio de cita',
        `Mañana tienes ${service?.name ?? 'tu servicio'} a las ${b.startAt.slice(11)}. Código ${b.code}.`,
        { bookingId: b.id },
      );
      sent++;
    }
    return sent;
  }

  private async notifyWaitlist(b: Booking) {
    const date = b.startAt.slice(0, 10);
    const entries = await this.waitlist.listForDate(date, b.serviceId, b.staffId);
    const pending = entries.filter((e) => !e.notifiedAt);
    if (!pending.length) return;
    for (const e of pending) {
      await this.notifier.notify(
        e.clientId,
        'WAITLIST_SLOT_AVAILABLE',
        '¡Se liberó un espacio!',
        `Hay disponibilidad el ${date} para el servicio que esperabas. Reserva antes de que se agote.`,
        { date, serviceId: b.serviceId, staffId: b.staffId },
      );
    }
    await this.waitlist.markNotified(pending.map((e) => e.id));
  }
}
