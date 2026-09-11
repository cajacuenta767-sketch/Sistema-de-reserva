import type { Staff, TimeOff, WorkingHours } from '../../../domain/entities/Staff.js';
import type { StaffRepository } from '../../../application/ports/index.js';
import { newId } from '../../../shared/id.js';
import type { LocalDateTime } from '../../../shared/dates.js';
import { transaction, type Db } from '../connection.js';
import { staffFromRow, timeOffFromRow, workingHoursFromRow, type Row } from './mappers.js';

export class SqliteStaffRepository implements StaffRepository {
  constructor(private readonly db: Db) {}

  async list(opts?: { includeInactive?: boolean; serviceId?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!opts?.includeInactive) where.push('s.is_active = 1');
    if (opts?.serviceId) {
      where.push('EXISTS (SELECT 1 FROM staff_services ss WHERE ss.staff_id = s.id AND ss.service_id = ?)');
      params.push(opts.serviceId);
    }
    const sql = `SELECT s.* FROM staff s ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.rating_avg DESC, s.display_name`;
    return (this.db.prepare(sql).all(...(params as any[])) as Row[]).map(staffFromRow);
  }
  async findById(id: string) {
    const r = this.db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as Row | undefined;
    return r ? staffFromRow(r) : null;
  }
  async findByUserId(userId: string) {
    const r = this.db.prepare('SELECT * FROM staff WHERE user_id = ?').get(userId) as Row | undefined;
    return r ? staffFromRow(r) : null;
  }
  async save(s: Staff) {
    this.db
      .prepare(
        `INSERT INTO staff (id,user_id,display_name,title,bio,avatar_url,email,phone,is_active,rating_avg,rating_count,completed_jobs,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(s.id, s.userId, s.displayName, s.title, s.bio, s.avatarUrl, s.email, s.phone, s.isActive ? 1 : 0, s.ratingAvg, s.ratingCount, s.completedJobs, s.createdAt, s.updatedAt);
  }
  async update(s: Staff) {
    this.db
      .prepare(
        `UPDATE staff SET display_name=?, title=?, bio=?, avatar_url=?, email=?, phone=?, is_active=?, rating_avg=?, rating_count=?, completed_jobs=?, updated_at=? WHERE id=?`,
      )
      .run(s.displayName, s.title, s.bio, s.avatarUrl, s.email, s.phone, s.isActive ? 1 : 0, s.ratingAvg, s.ratingCount, s.completedJobs, s.updatedAt, s.id);
  }
  async delete(id: string) {
    this.db.prepare('DELETE FROM staff WHERE id = ?').run(id);
  }
  async serviceIdsOf(staffId: string) {
    return (this.db.prepare('SELECT service_id FROM staff_services WHERE staff_id = ?').all(staffId) as Row[]).map((r) => r.service_id as string);
  }
  async setServices(staffId: string, serviceIds: string[]) {
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM staff_services WHERE staff_id = ?').run(staffId);
      const ins = this.db.prepare('INSERT OR IGNORE INTO staff_services (staff_id, service_id) VALUES (?, ?)');
      for (const sid of serviceIds) ins.run(staffId, sid);
    });
  }
  async workingHours(staffId: string) {
    return (this.db.prepare('SELECT * FROM working_hours WHERE staff_id = ? ORDER BY weekday, start_time').all(staffId) as Row[]).map(workingHoursFromRow);
  }
  async setWorkingHours(staffId: string, hours: Omit<WorkingHours, 'id' | 'staffId'>[]) {
    return transaction(this.db, () => {
      this.db.prepare('DELETE FROM working_hours WHERE staff_id = ?').run(staffId);
      const ins = this.db.prepare('INSERT INTO working_hours (id, staff_id, weekday, start_time, end_time) VALUES (?,?,?,?,?)');
      const out: WorkingHours[] = [];
      for (const h of hours) {
        const id = newId();
        ins.run(id, staffId, h.weekday, h.startTime, h.endTime);
        out.push({ id, staffId, ...h });
      }
      return out;
    });
  }
  async timeOff(staffId: string, from?: LocalDateTime, to?: LocalDateTime) {
    if (from && to) {
      return (
        this.db
          .prepare('SELECT * FROM time_off WHERE staff_id = ? AND start_at < ? AND end_at > ? ORDER BY start_at')
          .all(staffId, to, from) as Row[]
      ).map(timeOffFromRow);
    }
    return (this.db.prepare('SELECT * FROM time_off WHERE staff_id = ? ORDER BY start_at').all(staffId) as Row[]).map(timeOffFromRow);
  }
  async addTimeOff(t: TimeOff) {
    this.db.prepare('INSERT INTO time_off (id, staff_id, start_at, end_at, reason) VALUES (?,?,?,?,?)').run(t.id, t.staffId, t.startAt, t.endAt, t.reason);
  }
  async removeTimeOff(id: string) {
    this.db.prepare('DELETE FROM time_off WHERE id = ?').run(id);
  }
}
