import type { LocalDate, LocalDateTime } from '../../shared/dates.js';
import type { Booking, BookingStatus } from '../../domain/entities/Booking.js';
import type { Coupon } from '../../domain/entities/Coupon.js';
import type { Notification } from '../../domain/entities/Notification.js';
import type { Review } from '../../domain/entities/Review.js';
import type { Category, Service } from '../../domain/entities/Service.js';
import type { Staff, TimeOff, WorkingHours } from '../../domain/entities/Staff.js';
import type { User } from '../../domain/entities/User.js';
import type { WaitlistEntry } from '../../domain/entities/Waitlist.js';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
  update(user: User): Promise<void>;
  list(): Promise<User[]>;
}

export interface CategoryRepository {
  list(): Promise<Category[]>;
  findById(id: string): Promise<Category | null>;
  save(c: Category): Promise<void>;
  update(c: Category): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface ServiceRepository {
  list(opts?: { includeInactive?: boolean; categoryId?: string }): Promise<Service[]>;
  findById(id: string): Promise<Service | null>;
  findBySlug(slug: string): Promise<Service | null>;
  save(s: Service): Promise<void>;
  update(s: Service): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface StaffRepository {
  list(opts?: { includeInactive?: boolean; serviceId?: string }): Promise<Staff[]>;
  findById(id: string): Promise<Staff | null>;
  findByUserId(userId: string): Promise<Staff | null>;
  save(s: Staff): Promise<void>;
  update(s: Staff): Promise<void>;
  delete(id: string): Promise<void>;
  serviceIdsOf(staffId: string): Promise<string[]>;
  setServices(staffId: string, serviceIds: string[]): Promise<void>;
  workingHours(staffId: string): Promise<WorkingHours[]>;
  setWorkingHours(staffId: string, hours: Omit<WorkingHours, 'id' | 'staffId'>[]): Promise<WorkingHours[]>;
  timeOff(staffId: string, from?: LocalDateTime, to?: LocalDateTime): Promise<TimeOff[]>;
  addTimeOff(t: TimeOff): Promise<void>;
  removeTimeOff(id: string): Promise<void>;
}

export interface BookingFilters {
  clientId?: string;
  staffId?: string;
  serviceId?: string;
  status?: BookingStatus[];
  from?: LocalDateTime;
  to?: LocalDateTime;
  seriesId?: string;
  limit?: number;
  offset?: number;
}

export interface BookingRepository {
  findById(id: string): Promise<Booking | null>;
  findByCode(code: string): Promise<Booking | null>;
  list(filters: BookingFilters): Promise<Booking[]>;
  count(filters: BookingFilters): Promise<number>;
  /** Reservas activas del profesional que solapan con el intervalo dado */
  activeForStaffBetween(staffId: string, from: LocalDateTime, to: LocalDateTime, excludeId?: string): Promise<Booking[]>;
  /** Inserta atómicamente todas las reservas o ninguna. */
  saveMany(bookings: Booking[]): Promise<void>;
  update(b: Booking): Promise<void>;
  stats(from: LocalDateTime, to: LocalDateTime): Promise<{
    byStatus: Record<BookingStatus, number>;
    revenueCents: number;
    total: number;
  }>;
}

export interface ReviewRepository {
  findByBookingId(bookingId: string): Promise<Review | null>;
  list(opts?: { staffId?: string; limit?: number; minRating?: number }): Promise<Review[]>;
  save(r: Review): Promise<void>;
  aggregateForStaff(staffId: string): Promise<{ avg: number; count: number }>;
}

export interface CouponRepository {
  findByCode(code: string): Promise<Coupon | null>;
  list(): Promise<Coupon[]>;
  save(c: Coupon): Promise<void>;
  update(c: Coupon): Promise<void>;
  delete(id: string): Promise<void>;
  incrementUsage(id: string, delta: number): Promise<void>;
}

export interface NotificationRepository {
  listForUser(userId: string, opts?: { unreadOnly?: boolean; limit?: number }): Promise<Notification[]>;
  save(n: Notification): Promise<void>;
  markRead(userId: string, ids: string[] | 'all'): Promise<number>;
  unreadCount(userId: string): Promise<number>;
}

export interface WaitlistRepository {
  save(w: WaitlistEntry): Promise<void>;
  listForDate(date: LocalDate, serviceId?: string, staffId?: string | null): Promise<WaitlistEntry[]>;
  listForClient(clientId: string): Promise<WaitlistEntry[]>;
  markNotified(ids: string[]): Promise<void>;
  delete(id: string): Promise<void>;
}
