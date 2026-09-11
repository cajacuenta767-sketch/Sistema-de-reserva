import { z } from 'zod';

export const idParam = z.object({ id: z.string().min(1) });
export const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD');
export const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Formato YYYY-MM-DDTHH:MM');
export const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Formato HH:MM');
export const month = z.string().regex(/^\d{4}-\d{2}$/, 'Formato YYYY-MM');
const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

export const registerBody = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().max(30).optional(),
});
export const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });
export const refreshBody = z.object({ refreshToken: z.string().min(10) });
export const profileBody = z.object({
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  phone: z.string().max(30).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
});
export const changePasswordBody = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });

export const categoryBody = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().optional(),
  icon: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export const serviceBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  durationMinutes: z.number().int().positive().max(24 * 60),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  priceCents: z.number().int().min(0),
  currency: z.string().length(3).optional(),
  categoryId: z.string().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
});
export const servicesQuery = z.object({ categoryId: z.string().optional(), includeInactive: bool.optional() });

export const workingHoursItem = z.object({ weekday: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm });
export const staffCreateBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  displayName: z.string().optional(),
  title: z.string().min(1).max(80),
  bio: z.string().max(2000).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  phone: z.string().nullable().optional(),
  serviceIds: z.array(z.string()).optional(),
  workingHours: z.array(workingHoursItem).optional(),
});
export const staffUpdateBody = z.object({
  displayName: z.string().min(1).optional(),
  title: z.string().optional(),
  bio: z.string().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  phone: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  serviceIds: z.array(z.string()).optional(),
});
export const staffListQuery = z.object({
  serviceId: z.string().optional(),
  availableOn: localDate.optional(),
  includeInactive: bool.optional(),
});
export const workingHoursBody = z.object({ hours: z.array(workingHoursItem) });
export const timeOffBody = z.object({ startAt: localDateTime, endAt: localDateTime, reason: z.string().max(200).nullable().optional() });
export const availabilityQuery = z.object({ serviceId: z.string().min(1), date: localDate });
export const monthAvailabilityQuery = z.object({ serviceId: z.string().min(1), month });

export const frequency = z.enum(['ONCE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY']);
export const bookingCreateBody = z.object({
  staffId: z.string().min(1),
  serviceId: z.string().min(1),
  startAt: localDateTime,
  frequency: frequency.optional(),
  occurrences: z.number().int().min(1).max(12).optional(),
  couponCode: z.string().max(40).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  /** Datos de contacto que el cliente puede actualizar al reservar */
  contact: profileBody.optional(),
});
export const bookingQuoteBody = z.object({
  serviceId: z.string().min(1),
  couponCode: z.string().max(40).nullable().optional(),
  frequency: frequency.optional(),
  occurrences: z.number().int().min(1).max(12).optional(),
});
export const bookingListQuery = z.object({
  status: z.string().optional(), // CSV
  from: localDateTime.optional(),
  to: localDateTime.optional(),
  staffId: z.string().optional(),
  clientId: z.string().optional(),
  serviceId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  upcoming: bool.optional(),
});
export const cancelBody = z.object({ reason: z.string().max(300).optional(), wholeSeries: z.boolean().optional() });
export const rescheduleBody = z.object({ startAt: localDateTime });
export const statusBody = z.object({ status: z.enum(['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']) });

export const reviewBody = z.object({ bookingId: z.string().min(1), rating: z.number().int().min(1).max(5), comment: z.string().max(1000).default('') });
export const reviewsQuery = z.object({ staffId: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional(), minRating: z.coerce.number().int().min(1).max(5).optional() });

export const couponBody = z.object({
  code: z.string().min(2).max(40),
  description: z.string().max(200).default(''),
  discountType: z.enum(['PERCENT', 'FIXED']),
  value: z.number().int().positive(),
  minAmountCents: z.number().int().min(0).default(0),
  maxUses: z.number().int().positive().nullable().default(null),
  validFrom: z.string().datetime().nullable().default(null),
  validUntil: z.string().datetime().nullable().default(null),
  isActive: z.boolean().default(true),
});
export const couponValidateBody = z.object({ code: z.string().min(1), serviceId: z.string().min(1) });

export const notificationsQuery = z.object({ unreadOnly: bool.optional() });
export const markReadBody = z.object({ ids: z.union([z.array(z.string()), z.literal('all')]) });

export const waitlistBody = z.object({ serviceId: z.string().min(1), date: localDate, staffId: z.string().nullable().optional() });
export const statsQuery = z.object({ from: localDate.optional(), to: localDate.optional() });
