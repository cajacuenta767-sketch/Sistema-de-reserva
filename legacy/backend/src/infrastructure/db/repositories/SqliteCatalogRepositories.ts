import type { Category, Service } from '../../../domain/entities/Service.js';
import type { CategoryRepository, ServiceRepository } from '../../../application/ports/index.js';
import type { Db } from '../connection.js';
import { categoryFromRow, serviceFromRow, type Row } from './mappers.js';

export class SqliteCategoryRepository implements CategoryRepository {
  constructor(private readonly db: Db) {}
  async list() {
    return (this.db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as Row[]).map(categoryFromRow);
  }
  async findById(id: string) {
    const r = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Row | undefined;
    return r ? categoryFromRow(r) : null;
  }
  async save(c: Category) {
    this.db.prepare('INSERT INTO categories (id,name,slug,icon,sort_order) VALUES (?,?,?,?,?)').run(c.id, c.name, c.slug, c.icon, c.sortOrder);
  }
  async update(c: Category) {
    this.db.prepare('UPDATE categories SET name=?, slug=?, icon=?, sort_order=? WHERE id=?').run(c.name, c.slug, c.icon, c.sortOrder, c.id);
  }
  async delete(id: string) {
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  }
}

export class SqliteServiceRepository implements ServiceRepository {
  constructor(private readonly db: Db) {}
  async list(opts?: { includeInactive?: boolean; categoryId?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!opts?.includeInactive) where.push('is_active = 1');
    if (opts?.categoryId) {
      where.push('category_id = ?');
      params.push(opts.categoryId);
    }
    const sql = `SELECT * FROM services ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY is_featured DESC, name`;
    return (this.db.prepare(sql).all(...(params as any[])) as Row[]).map(serviceFromRow);
  }
  async findById(id: string) {
    const r = this.db.prepare('SELECT * FROM services WHERE id = ?').get(id) as Row | undefined;
    return r ? serviceFromRow(r) : null;
  }
  async findBySlug(slug: string) {
    const r = this.db.prepare('SELECT * FROM services WHERE slug = ?').get(slug) as Row | undefined;
    return r ? serviceFromRow(r) : null;
  }
  async save(s: Service) {
    this.db
      .prepare(
        `INSERT INTO services (id,category_id,name,slug,description,duration_minutes,buffer_minutes,price_cents,currency,image_url,is_active,is_featured,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(s.id, s.categoryId, s.name, s.slug, s.description, s.durationMinutes, s.bufferMinutes, s.priceCents, s.currency, s.imageUrl, s.isActive ? 1 : 0, s.isFeatured ? 1 : 0, s.createdAt, s.updatedAt);
  }
  async update(s: Service) {
    this.db
      .prepare(
        `UPDATE services SET category_id=?, name=?, slug=?, description=?, duration_minutes=?, buffer_minutes=?, price_cents=?, currency=?, image_url=?, is_active=?, is_featured=?, updated_at=? WHERE id=?`,
      )
      .run(s.categoryId, s.name, s.slug, s.description, s.durationMinutes, s.bufferMinutes, s.priceCents, s.currency, s.imageUrl, s.isActive ? 1 : 0, s.isFeatured ? 1 : 0, s.updatedAt, s.id);
  }
  async delete(id: string) {
    this.db.prepare('DELETE FROM services WHERE id = ?').run(id);
  }
}
