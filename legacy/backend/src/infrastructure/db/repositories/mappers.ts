import type { Booking } from '../../../domain/entities/Booking.js';
import type { Coupon } from '../../../domain/entities/Coupon.js';
import type { Notification } from '../../../domain/entities/Notification.js';
import type { Review } from '../../../domain/entities/Review.js';
import type { Category, Service } from '../../../domain/entities/Service.js';
import type { Staff, TimeOff, WorkingHours } from '../../../domain/entities/Staff.js';
import type { User } from '../../../domain/entities/User.js';
import type { WaitlistEntry } from '../../../domain/entities/Waitlist.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export const userFromRow = (r: Row): User => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  firstName: r.first_name,
  lastName: r.last_name,
  phone: r.phone,
  role: r.role,
  address: r.address,
  city: r.city,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const categoryFromRow = (r: Row): Category => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  icon: r.icon,
  sortOrder: r.sort_order,
});

export const serviceFromRow = (r: Row): Service => ({
  id: r.id,
  categoryId: r.category_id,
  name: r.name,
  slug: r.slug,
  description: r.description,
  durationMinutes: r.duration_minutes,
  bufferMinutes: r.buffer_minutes,
  priceCents: r.price_cents,
  currency: r.currency,
  imageUrl: r.image_url,
  isActive: !!r.is_active,
  isFeatured: !!r.is_featured,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const staffFromRow = (r: Row): Staff => ({
  id: r.id,
  userId: r.user_id,
  displayName: r.display_name,
  title: r.title,
  bio: r.bio,
  avatarUrl: r.avatar_url,
  email: r.email,
  phone: r.phone,
  isActive: !!r.is_active,
  ratingAvg: r.rating_avg,
  ratingCount: r.rating_count,
  completedJobs: r.completed_jobs,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const workingHoursFromRow = (r: Row): WorkingHours => ({
  id: r.id,
  staffId: r.staff_id,
  weekday: r.weekday,
  startTime: r.start_time,
  endTime: r.end_time,
});

export const timeOffFromRow = (r: Row): TimeOff => ({
  id: r.id,
  staffId: r.staff_id,
  startAt: r.start_at,
  endAt: r.end_at,
  reason: r.reason,
});

export const bookingFromRow = (r: Row): Booking => ({
  id: r.id,
  code: r.code,
  seriesId: r.series_id,
  seriesIndex: r.series_index,
  frequency: r.frequency,
  clientId: r.client_id,
  staffId: r.staff_id,
  serviceId: r.service_id,
  startAt: r.start_at,
  endAt: r.end_at,
  status: r.status,
  priceCents: r.price_cents,
  discountCents: r.discount_cents,
  totalCents: r.total_cents,
  couponCode: r.coupon_code,
  notes: r.notes,
  address: r.address,
  cancelledAt: r.cancelled_at,
  cancelReason: r.cancel_reason,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const reviewFromRow = (r: Row): Review => ({
  id: r.id,
  bookingId: r.booking_id,
  clientId: r.client_id,
  staffId: r.staff_id,
  serviceId: r.service_id,
  rating: r.rating,
  comment: r.comment,
  createdAt: r.created_at,
});

export const couponFromRow = (r: Row): Coupon => ({
  id: r.id,
  code: r.code,
  description: r.description,
  discountType: r.discount_type,
  value: r.value,
  minAmountCents: r.min_amount_cents,
  maxUses: r.max_uses,
  usedCount: r.used_count,
  validFrom: r.valid_from,
  validUntil: r.valid_until,
  isActive: !!r.is_active,
});

export const notificationFromRow = (r: Row): Notification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  title: r.title,
  body: r.body,
  data: JSON.parse(r.data ?? '{}'),
  readAt: r.read_at,
  createdAt: r.created_at,
});

export const waitlistFromRow = (r: Row): WaitlistEntry => ({
  id: r.id,
  clientId: r.client_id,
  staffId: r.staff_id,
  serviceId: r.service_id,
  date: r.date,
  notifiedAt: r.notified_at,
  createdAt: r.created_at,
});
