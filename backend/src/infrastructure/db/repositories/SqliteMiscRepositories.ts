import type { Coupon } from '../../../domain/entities/Coupon.js';
import type { Notification } from '../../../domain/entities/Notification.js';
import type { Review } from '../../../domain/entities/Review.js';
import type { WaitlistEntry } from '../../../domain/entities/Waitlist.js';
import type { CouponRepository, NotificationRepository, ReviewRepository, WaitlistRepository } from '../../../application/ports/index.js';
import type { LocalDate } from '../../../shared/dates.js';
import type { Db } from '../connection.js';
import { couponFromRow, notificationFromRow, reviewFromRow, waitlistFromRow, type Row } from './mappers.js';

export class SqliteReviewRepository implements ReviewRepository {
  constructor(private readonly db: Db) {}
  async findByBookingId(bookingId: string) {
    const r = this.db.prepare('SELECT * FROM reviews WHERE booking_id = ?').get(bookingId) as Row | undefined;
    return r ? reviewFromRow(r) : null;
  }
  async list(opts?: { staffId?: string; limit?: number; minRating?: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts?.staffId) { where.push('staff_id = ?'); params.push(opts.staffId); }
    if (opts?.minRating) { where.push('rating >= ?'); params.push(opts.minRating); }
    const sql = `SELECT * FROM reviews ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...(params as any[]), opts?.limit ?? 50) as Row[]).map(reviewFromRow);
  }
  async save(r: Review) {
    this.db
      .prepare('INSERT INTO reviews (id,booking_id,client_id,staff_id,service_id,rating,comment,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(r.id, r.bookingId, r.clientId, r.staffId, r.serviceId, r.rating, r.comment, r.createdAt);
  }
  async aggregateForStaff(staffId: string) {
    const r = this.db.prepare('SELECT AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE staff_id = ?').get(staffId) as Row;
    return { avg: Number(r.avg ?? 0), count: Number(r.count ?? 0) };
  }
}

export class SqliteCouponRepository implements CouponRepository {
  constructor(private readonly db: Db) {}
  async findByCode(code: string) {
    const r = this.db.prepare('SELECT * FROM coupons WHERE code = ?').get(code.toUpperCase()) as Row | undefined;
    return r ? couponFromRow(r) : null;
  }
  async list() {
    return (this.db.prepare('SELECT * FROM coupons ORDER BY code').all() as Row[]).map(couponFromRow);
  }
  async save(c: Coupon) {
    this.db
      .prepare('INSERT INTO coupons (id,code,description,discount_type,value,min_amount_cents,max_uses,used_count,valid_from,valid_until,is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(c.id, c.code, c.description, c.discountType, c.value, c.minAmountCents, c.maxUses, c.usedCount, c.validFrom, c.validUntil, c.isActive ? 1 : 0);
  }
  async update(c: Coupon) {
    this.db
      .prepare('UPDATE coupons SET code=?, description=?, discount_type=?, value=?, min_amount_cents=?, max_uses=?, used_count=?, valid_from=?, valid_until=?, is_active=? WHERE id=?')
      .run(c.code, c.description, c.discountType, c.value, c.minAmountCents, c.maxUses, c.usedCount, c.validFrom, c.validUntil, c.isActive ? 1 : 0, c.id);
  }
  async delete(id: string) {
    this.db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
  }
  async incrementUsage(id: string, delta: number) {
    this.db.prepare('UPDATE coupons SET used_count = used_count + ? WHERE id = ?').run(delta, id);
  }
}

export class SqliteNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Db) {}
  async listForUser(userId: string, opts?: { unreadOnly?: boolean; limit?: number }) {
    const sql = `SELECT * FROM notifications WHERE user_id = ? ${opts?.unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`;
    return (this.db.prepare(sql).all(userId, opts?.limit ?? 50) as Row[]).map(notificationFromRow);
  }
  async save(n: Notification) {
    this.db
      .prepare('INSERT INTO notifications (id,user_id,type,title,body,data,read_at,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(n.id, n.userId, n.type, n.title, n.body, JSON.stringify(n.data), n.readAt, n.createdAt);
  }
  async markRead(userId: string, ids: string[] | 'all') {
    const now = new Date().toISOString();
    if (ids === 'all') {
      const r = this.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId);
      return Number(r.changes);
    }
    if (!ids.length) return 0;
    const r = this.db
      .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`)
      .run(now, userId, ...ids);
    return Number(r.changes);
  }
  async unreadCount(userId: string) {
    const r = this.db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as Row;
    return Number(r.c);
  }
}

export class SqliteWaitlistRepository implements WaitlistRepository {
  constructor(private readonly db: Db) {}
  async save(w: WaitlistEntry) {
    this.db
      .prepare('INSERT INTO waitlist (id,client_id,staff_id,service_id,date,notified_at,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(w.id, w.clientId, w.staffId, w.serviceId, w.date, w.notifiedAt, w.createdAt);
  }
  async listForDate(date: LocalDate, serviceId?: string, staffId?: string | null) {
    const where = ['date = ?'];
    const params: unknown[] = [date];
    if (serviceId) { where.push('service_id = ?'); params.push(serviceId); }
    if (staffId) { where.push('(staff_id IS NULL OR staff_id = ?)'); params.push(staffId); }
    return (this.db.prepare(`SELECT * FROM waitlist WHERE ${where.join(' AND ')} ORDER BY created_at`).all(...(params as any[])) as Row[]).map(waitlistFromRow);
  }
  async listForClient(clientId: string) {
    return (this.db.prepare('SELECT * FROM waitlist WHERE client_id = ? ORDER BY date').all(clientId) as Row[]).map(waitlistFromRow);
  }
  async markNotified(ids: string[]) {
    if (!ids.length) return;
    this.db.prepare(`UPDATE waitlist SET notified_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(new Date().toISOString(), ...ids);
  }
  async delete(id: string) {
    this.db.prepare('DELETE FROM waitlist WHERE id = ?').run(id);
  }
}
