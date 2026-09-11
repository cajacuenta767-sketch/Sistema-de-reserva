import type { User } from '../../../domain/entities/User.js';
import type { UserRepository } from '../../../application/ports/index.js';
import type { Db } from '../connection.js';
import { userFromRow, type Row } from './mappers.js';

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string) {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return r ? userFromRow(r) : null;
  }
  async findByEmail(email: string) {
    const r = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as Row | undefined;
    return r ? userFromRow(r) : null;
  }
  async save(u: User) {
    this.db
      .prepare(
        `INSERT INTO users (id,email,password_hash,first_name,last_name,phone,role,address,city,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(u.id, u.email, u.passwordHash, u.firstName, u.lastName, u.phone, u.role, u.address, u.city, u.createdAt, u.updatedAt);
  }
  async update(u: User) {
    this.db
      .prepare(
        `UPDATE users SET email=?, password_hash=?, first_name=?, last_name=?, phone=?, role=?, address=?, city=?, updated_at=? WHERE id=?`,
      )
      .run(u.email, u.passwordHash, u.firstName, u.lastName, u.phone, u.role, u.address, u.city, u.updatedAt, u.id);
  }
  async list() {
    return (this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as Row[]).map(userFromRow);
  }
}
