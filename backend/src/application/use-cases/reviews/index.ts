import { AppError } from '../../../shared/AppError.js';
import type { Clock } from '../../../shared/Clock.js';
import { newId } from '../../../shared/id.js';
import type { Review } from '../../../domain/entities/Review.js';
import type { BookingRepository, ReviewRepository, StaffRepository } from '../../ports/index.js';
import type { NotificationService } from '../../services/NotificationService.js';

export class ReviewUseCases {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly bookings: BookingRepository,
    private readonly staff: StaffRepository,
    private readonly notifier: NotificationService,
    private readonly clock: Clock,
  ) {}

  async create(clientId: string, bookingId: string, rating: number, comment: string) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw AppError.validation('La calificación debe ser de 1 a 5');
    const b = await this.bookings.findById(bookingId);
    if (!b) throw AppError.notFound('Reserva');
    if (b.clientId !== clientId) throw AppError.forbidden();
    if (b.status !== 'COMPLETED') throw AppError.rule('Solo puedes reseñar reservas completadas');
    if (await this.reviews.findByBookingId(bookingId)) throw AppError.conflict('Esta reserva ya tiene reseña');
    const r: Review = {
      id: newId(),
      bookingId,
      clientId,
      staffId: b.staffId,
      serviceId: b.serviceId,
      rating,
      comment: comment.trim(),
      createdAt: this.clock.now().toISOString(),
    };
    await this.reviews.save(r);
    const agg = await this.reviews.aggregateForStaff(b.staffId);
    const s = await this.staff.findById(b.staffId);
    if (s) {
      await this.staff.update({ ...s, ratingAvg: Math.round(agg.avg * 10) / 10, ratingCount: agg.count, updatedAt: r.createdAt });
      await this.notifier.notify(s.userId, 'REVIEW_RECEIVED', 'Nueva reseña', `Recibiste ${rating} estrellas: "${r.comment}"`, { reviewId: r.id });
    }
    return r;
  }

  list(opts?: { staffId?: string; limit?: number; minRating?: number }) {
    return this.reviews.list(opts);
  }
}
