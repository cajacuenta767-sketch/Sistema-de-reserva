import { addDays, toLocalDate, type LocalDate } from '../../../shared/dates.js';
import type { Clock } from '../../../shared/Clock.js';
import { toPublicUser } from '../../../domain/entities/User.js';
import type { BookingRepository, ReviewRepository, StaffRepository, UserRepository } from '../../ports/index.js';

export class AdminUseCases {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly staff: StaffRepository,
    private readonly users: UserRepository,
    private readonly reviews: ReviewRepository,
    private readonly clock: Clock,
  ) {}

  async stats(from?: LocalDate, to?: LocalDate) {
    const today = toLocalDate(this.clock.now());
    const start = from ?? addDays(today, -30);
    const end = to ?? addDays(today, 30);
    const [range, todayStats, staffList, reviews] = await Promise.all([
      this.bookings.stats(`${start}T00:00`, `${end}T23:59`),
      this.bookings.stats(`${today}T00:00`, `${today}T23:59`),
      this.staff.list({ includeInactive: true }),
      this.reviews.list({ limit: 1000 }),
    ]);
    const days: { date: LocalDate; bookings: number; revenueCents: number }[] = [];
    for (let d = addDays(today, -13); d <= today; d = addDays(d, 1)) {
      const s = await this.bookings.stats(`${d}T00:00`, `${d}T23:59`);
      days.push({ date: d, bookings: s.total, revenueCents: s.revenueCents });
    }
    const avgRating = reviews.length ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length : 0;
    return {
      range: { from: start, to: end, ...range },
      today: todayStats,
      staff: staffList.map((s) => ({ id: s.id, name: s.displayName, rating: s.ratingAvg, completedJobs: s.completedJobs, isActive: s.isActive })),
      reviews: { count: reviews.length, avgRating: Math.round(avgRating * 10) / 10 },
      last14Days: days,
    };
  }

  async listUsers() {
    return (await this.users.list()).map(toPublicUser);
  }
}
