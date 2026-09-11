import { AppError } from '../../../shared/AppError.js';
import { newId } from '../../../shared/id.js';
import type { Coupon } from '../../../domain/entities/Coupon.js';
import type { CouponRepository } from '../../ports/index.js';

export type CouponInput = Omit<Coupon, 'id' | 'usedCount'> & { usedCount?: number };

export class CouponUseCases {
  constructor(private readonly coupons: CouponRepository) {}

  list() {
    return this.coupons.list();
  }

  async create(input: CouponInput) {
    const code = input.code.trim().toUpperCase();
    if (await this.coupons.findByCode(code)) throw AppError.conflict('El código de cupón ya existe');
    if (input.discountType === 'PERCENT' && (input.value <= 0 || input.value > 100)) throw AppError.validation('Porcentaje inválido');
    const c: Coupon = { ...input, id: newId(), code, usedCount: input.usedCount ?? 0 };
    await this.coupons.save(c);
    return c;
  }

  async update(id: string, patch: Partial<CouponInput>) {
    const all = await this.coupons.list();
    const c = all.find((x) => x.id === id);
    if (!c) throw AppError.notFound('Cupón');
    const updated: Coupon = { ...c, ...patch, id, code: (patch.code ?? c.code).toUpperCase() };
    await this.coupons.update(updated);
    return updated;
  }

  async remove(id: string) {
    await this.coupons.delete(id);
  }
}
