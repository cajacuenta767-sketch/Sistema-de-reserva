export type Role = 'CLIENT' | 'STAFF' | 'ADMIN';
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type Frequency = 'ONCE' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

export interface User {
  id: string; email: string; firstName: string; lastName: string; phone: string | null; role: Role;
  address: string | null; city: string | null; createdAt: string;
}
export interface Tokens { accessToken: string; refreshToken: string }
export interface Category { id: string; name: string; slug: string; icon: string | null; sortOrder: number }
export interface Service {
  id: string; categoryId: string | null; name: string; slug: string; description: string; durationMinutes: number;
  bufferMinutes: number; priceCents: number; currency: string; imageUrl: string | null; isActive: boolean; isFeatured: boolean;
}
export interface Staff {
  id: string; userId: string; displayName: string; title: string; bio: string; avatarUrl: string | null; email: string;
  phone: string | null; isActive: boolean; ratingAvg: number; ratingCount: number; completedJobs: number; serviceIds: string[];
}
export interface WorkingHours { id: string; staffId: string; weekday: number; startTime: string; endTime: string }
export interface TimeOff { id: string; staffId: string; startAt: string; endAt: string; reason: string | null }
export interface Slot { startAt: string; endAt: string; time: string }
export interface MonthAvailability { days: { date: string; slots: number }[] }
export interface Booking {
  id: string; code: string; seriesId: string | null; seriesIndex: number; frequency: Frequency; clientId: string; staffId: string;
  serviceId: string; startAt: string; endAt: string; status: BookingStatus; priceCents: number; discountCents: number; totalCents: number;
  couponCode: string | null; notes: string | null; address: string | null; cancelReason: string | null; createdAt: string;
  staff: { id: string; displayName: string; avatarUrl: string | null; title: string } | null;
  service: { id: string; name: string; durationMinutes: number; currency: string } | null;
  client: { id: string; firstName: string; lastName: string; email: string; phone: string | null } | null;
  hasReview: boolean;
}
export interface Quote {
  priceCents: number; discountCents: number; totalCents: number; occurrences: number; grandTotalCents: number; currency: string;
  coupon: { code: string; description: string } | null;
}
export interface Review {
  id: string; bookingId: string; rating: number; comment: string; createdAt: string; clientName: string; staffName: string | null; serviceName: string | null; staffId: string;
}
export interface Coupon {
  id: string; code: string; description: string; discountType: 'PERCENT' | 'FIXED'; value: number; minAmountCents: number;
  maxUses: number | null; usedCount: number; validFrom: string | null; validUntil: string | null; isActive: boolean;
}
export interface Notification { id: string; type: string; title: string; body: string; data: Record<string, unknown>; readAt: string | null; createdAt: string }
export interface Stats {
  range: { from: string; to: string; byStatus: Record<BookingStatus, number>; revenueCents: number; total: number };
  today: { byStatus: Record<BookingStatus, number>; revenueCents: number; total: number };
  staff: { id: string; name: string; rating: number; completedJobs: number; isActive: boolean }[];
  reviews: { count: number; avgRating: number };
  last14Days: { date: string; bookings: number; revenueCents: number }[];
}
export interface WaitlistEntry { id: string; serviceId: string; staffId: string | null; date: string; notifiedAt: string | null }
