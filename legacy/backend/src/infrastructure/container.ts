import type { Env } from '../config/env.js';
import { SystemClock, type Clock } from '../shared/Clock.js';
import { NotificationService } from '../application/services/NotificationService.js';
import { AdminUseCases } from '../application/use-cases/admin/index.js';
import { AuthUseCases } from '../application/use-cases/auth/index.js';
import { BookingUseCases } from '../application/use-cases/bookings/index.js';
import { CatalogUseCases } from '../application/use-cases/catalog/index.js';
import { CouponUseCases } from '../application/use-cases/coupons/index.js';
import { NotificationUseCases } from '../application/use-cases/notifications/index.js';
import { ReviewUseCases } from '../application/use-cases/reviews/index.js';
import { StaffUseCases } from '../application/use-cases/staff/index.js';
import { WaitlistUseCases } from '../application/use-cases/waitlist/index.js';
import { openDatabase, type Db } from './db/connection.js';
import { SqliteBookingRepository } from './db/repositories/SqliteBookingRepository.js';
import { SqliteCategoryRepository, SqliteServiceRepository } from './db/repositories/SqliteCatalogRepositories.js';
import { SqliteCouponRepository, SqliteNotificationRepository, SqliteReviewRepository, SqliteWaitlistRepository } from './db/repositories/SqliteMiscRepositories.js';
import { SqliteStaffRepository } from './db/repositories/SqliteStaffRepository.js';
import { SqliteUserRepository } from './db/repositories/SqliteUserRepository.js';
import { ConsoleMailer } from './notifications/ConsoleMailer.js';
import { JwtTokenService } from './security/JwtTokenService.js';
import { ScryptPasswordHasher } from './security/ScryptPasswordHasher.js';

/** Raíz de composición: instancia adaptadores y los inyecta en los casos de uso. */
export const buildContainer = (env: Env, opts: { clock?: Clock; db?: Db } = {}) => {
  const clock = opts.clock ?? new SystemClock();
  const db = opts.db ?? openDatabase(env.DATABASE_PATH);

  const repos = {
    users: new SqliteUserRepository(db),
    categories: new SqliteCategoryRepository(db),
    services: new SqliteServiceRepository(db),
    staff: new SqliteStaffRepository(db),
    bookings: new SqliteBookingRepository(db),
    reviews: new SqliteReviewRepository(db),
    coupons: new SqliteCouponRepository(db),
    notifications: new SqliteNotificationRepository(db),
    waitlist: new SqliteWaitlistRepository(db),
  };

  const hasher = new ScryptPasswordHasher();
  const tokens = new JwtTokenService({
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
  });
  const mailer = new ConsoleMailer();
  const notifier = new NotificationService(repos.notifications, repos.users, mailer, clock);

  const useCases = {
    auth: new AuthUseCases(repos.users, hasher, tokens, clock),
    catalog: new CatalogUseCases(repos.services, repos.categories, clock),
    staff: new StaffUseCases(repos.staff, repos.users, repos.services, repos.bookings, hasher, clock),
    bookings: new BookingUseCases(repos.bookings, repos.staff, repos.services, repos.users, repos.coupons, repos.waitlist, notifier, clock),
    reviews: new ReviewUseCases(repos.reviews, repos.bookings, repos.staff, notifier, clock),
    coupons: new CouponUseCases(repos.coupons),
    notifications: new NotificationUseCases(repos.notifications),
    waitlist: new WaitlistUseCases(repos.waitlist, repos.services, clock),
    admin: new AdminUseCases(repos.bookings, repos.staff, repos.users, repos.reviews, clock),
  };

  return { env, db, clock, repos, hasher, tokens, mailer, notifier, useCases };
};

export type Container = ReturnType<typeof buildContainer>;
