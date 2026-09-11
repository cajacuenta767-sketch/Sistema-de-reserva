export type DiscountType = 'PERCENT' | 'FIXED';

export interface Coupon {
  id: string;
  code: string;
  description: string;
  discountType: DiscountType;
  /** Porcentaje (0-100) o centavos según discountType */
  value: number;
  minAmountCents: number;
  maxUses: number | null;
  usedCount: number;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
}

export const computeDiscount = (coupon: Coupon, priceCents: number): number => {
  if (coupon.discountType === 'PERCENT') {
    return Math.min(priceCents, Math.round((priceCents * coupon.value) / 100));
  }
  return Math.min(priceCents, coupon.value);
};
