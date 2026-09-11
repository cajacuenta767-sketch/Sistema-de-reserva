import { ACTIVE_STATUSES, type Booking, type BookingStatus } from '../../../domain/entities/Booking.js';
import type { BookingFilters, BookingRepository } from '../../../application/ports/index.js';
import type { LocalDateTime } from '../../../shared/dates.js';
import { transaction, type Db } from '../connection.js';
import { AppError } from '../../../shared/AppError.js';
import { bookingFromRow, type Row } from './mappers.js';

const buildWhere = (f: BookingFilters) => {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.clientId) { where.push('client_id = ?'); params.push(f.clientId); }
  if (f.staffId) { where.push('staff_id = ?'); params.push(f.staffId); }
  if (f.serviceId) { where.push('service_id = ?'); params.push(f.serviceId); }
  if (f.seriesId) { where.push('series_id = ?'); params.push(f.seriesId); }
  if (f.status?.length) { where.push(`status IN (${f.status.map(() => '?').join(',')})`); params.push(...f.status); }
  if (f.from) { where.push('start_at >= ?'); params.push(f.from); }
  if (f.to) { where.push('start_at <= ?'); params.push(f.to); }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
};

export class SqliteBookingRepository implements BookingRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string) {
    const r = this.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as Row | undefined;
    return r ? bookingFromRow(r) : null;
  }
  async findByCode(code: string) {
    const r = this.db.prepare('SELECT * FROM bookings WHERE code = ?').get(code) as Row | undefined;
    return r ? bookingFromRow(r) : null;
  }
  async list(f: BookingFilters) {
    const { clause, params } = buildWhere(f);
    const limit = Math.min(f.limit ?? 100, 500);
    const offset = f.offset ?? 0;
    const rows = this.db.prepare(`SELECT * FROM bookings ${clause} ORDER BY start_at ASC LIMIT ? OFFSET ?`).all(...(params as any[]), limit, offset) as Row[];
    return rows.map(bookingFromRow);
  }
  async count(f: BookingFilters) {
    const { clause, params } = buildWhere(f);
    const r = this.db.prepare(`SELECT COUNT(*) AS c FROM bookings ${clause}`).get(...(params as any[])) as Row;
    return Number(r.c);
  }
  async activeForStaffBetween(staffId: string, from: LocalDateTime, to: LocalDateTime, excludeId?: string) {
    const rows = this.db
      .prepare(
        `SELECT * FROM bookings WHERE staff_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})
         AND start_at < ? AND end_at > ? AND id <> ? ORDER BY start_at`,
      )
      .all(staffId, ...ACTIVE_STATUSES, to, from, excludeId ?? '') as Row[];
    return rows.map(bookingFromRow);
  }
  async saveMany(bookings: Booking[]) {
    transaction(this.db, () => {
      const ins = this.db.prepare(
        `INSERT INTO bookings (id,code,series_id,series_index,frequency,client_id,staff_id,service_id,start_at,end_at,status,price_cents,discount_cents,total_cents,coupon_code,notes,address,cancelled_at,cancel_reason,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      // Chequeo de solape dentro de la transacción para evitar carreras.
      const clash = this.db.prepare(
        `SELECT 1 FROM bookings WHERE staff_id = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')}) AND start_at < ? AND end_at > ? LIMIT 1`,
      );
      for (const b of bookings) {
        if (clash.get(b.staffId, ...ACTIVE_STATUSES, b.endAt, b.startAt)) {
          throw AppError.conflict(`La franja ${b.startAt.replace('T', ' ')} acaba de ser tomada`, { unavailable: [b.startAt] });
        }
        ins.run(b.id, b.code, b.seriesId, b.seriesIndex, b.frequency, b.clientId, b.staffId, b.serviceId, b.startAt, b.endAt, b.status, b.priceCents, b.discountCents, b.totalCents, b.couponCode, b.notes, b.address, b.cancelledAt, b.cancelReason, b.createdAt, b.updatedAt);
      }
    });
  }
  async update(b: Booking) {
    this.db
      .prepare(
        `UPDATE bookings SET start_at=?, end_at=?, status=?, price_cents=?, discount_cents=?, total_cents=?, coupon_code=?, notes=?, address=?, cancelled_at=?, cancel_reason=?, updated_at=? WHERE id=?`,
      )
      .run(b.startAt, b.endAt, b.status, b.priceCents, b.discountCents, b.totalCents, b.couponCode, b.notes, b.address, b.cancelledAt, b.cancelReason, b.updatedAt, b.id);
  }
  async stats(from: LocalDateTime, to: LocalDateTime) {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) AS c, COALESCE(SUM(total_cents),0) AS s FROM bookings WHERE start_at >= ? AND start_at <= ? GROUP BY status`)
      .all(from, to) as Row[];
    const byStatus = { PENDING: 0, CONFIRMED: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, NO_SHOW: 0 } as Record<BookingStatus, number>;
    let revenueCents = 0;
    let total = 0;
    for (const r of rows) {
      byStatus[r.status as BookingStatus] = Number(r.c);
      total += Number(r.c);
      if (r.status === 'COMPLETED' || r.status === 'CONFIRMED' || r.status === 'IN_PROGRESS') revenueCents += Number(r.s);
    }
    return { byStatus, revenueCents, total };
  }
}
