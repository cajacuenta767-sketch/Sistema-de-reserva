import { Decimal } from './decimal.js';
import { currencyOf } from './currency.js';

/**
 * Importe monetario inmutable con aritmética decimal exacta.
 *
 * Regla del sistema: el dinero NUNCA se representa con `number`. PostgreSQL
 * devuelve `NUMERIC` como string y esa cadena entra aquí sin pérdida.
 */
export class Money {
  private constructor(
    readonly amount: Decimal,
    readonly currency: string,
  ) {}

  static of(value: Decimal.Value, currency: string): Money {
    return new Money(new Decimal(value), currency.toUpperCase());
  }

  static zero(currency: string): Money {
    return new Money(new Decimal(0), currency.toUpperCase());
  }

  /** Lee un `NUMERIC` de PostgreSQL (string) o null. */
  static fromDb(value: string | null | undefined, currency: string): Money {
    return new Money(new Decimal(value ?? 0), currency.toUpperCase());
  }

  private assertSame(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `No se pueden operar importes de monedas distintas: ${this.currency} y ${other.currency}`,
      );
    }
  }

  plus(other: Money): Money {
    this.assertSame(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  minus(other: Money): Money {
    this.assertSame(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  times(factor: Decimal.Value): Money {
    return new Money(this.amount.times(factor), this.currency);
  }

  dividedBy(divisor: Decimal.Value): Money {
    return new Money(this.amount.dividedBy(divisor), this.currency);
  }

  negated(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  percent(rate: Decimal.Value): Money {
    return new Money(this.amount.times(rate).dividedBy(100), this.currency);
  }

  /** Redondea a la escala contable de la moneda (media al alza, criterio fiscal). */
  round(decimals?: number): Money {
    const dp = decimals ?? currencyOf(this.currency).decimals;
    return new Money(this.amount.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }
  isNegative(): boolean {
    return this.amount.isNegative();
  }
  isPositive(): boolean {
    return this.amount.greaterThan(0);
  }
  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }
  greaterThan(other: Money): boolean {
    this.assertSame(other);
    return this.amount.greaterThan(other.amount);
  }
  lessThan(other: Money): boolean {
    this.assertSame(other);
    return this.amount.lessThan(other.amount);
  }

  /** Convierte a otra moneda aplicando una tasa. No redondea: hazlo al final. */
  convert(toCurrency: string, rate: Decimal.Value): Money {
    return new Money(this.amount.times(rate), toCurrency.toUpperCase());
  }

  /**
   * Reparte el importe en `n` partes o según pesos, sin perder ni un centavo:
   * los residuos del redondeo se distribuyen entre las primeras partes.
   * Imprescindible para prorratear descuentos y retenciones entre líneas.
   */
  allocate(weights: readonly Decimal.Value[], decimals?: number): Money[] {
    const dp = decimals ?? currencyOf(this.currency).decimals;
    const unit = new Decimal(10).pow(-dp);
    const ws = weights.map((w) => new Decimal(w));
    const totalWeight = ws.reduce((a, b) => a.plus(b), new Decimal(0));
    if (totalWeight.isZero()) return ws.map(() => Money.zero(this.currency));

    const parts = ws.map((w) =>
      this.amount.times(w).dividedBy(totalWeight).toDecimalPlaces(dp, Decimal.ROUND_DOWN),
    );
    let remainder = this.amount
      .toDecimalPlaces(dp, Decimal.ROUND_HALF_UP)
      .minus(parts.reduce((a, b) => a.plus(b), new Decimal(0)));
    for (let i = 0; remainder.abs().greaterThanOrEqualTo(unit) && i < parts.length; i++) {
      const step = remainder.isNegative() ? unit.negated() : unit;
      parts[i] = (parts[i] ?? new Decimal(0)).plus(step);
      remainder = remainder.minus(step);
    }
    return parts.map((p) => new Money(p, this.currency));
  }

  /** Cadena para `NUMERIC` de PostgreSQL. Siempre con la escala contable. */
  toDb(decimals?: number): string {
    const dp = decimals ?? currencyOf(this.currency).decimals;
    return this.amount.toFixed(dp);
  }

  toNumber(): number {
    return this.amount.toNumber();
  }

  toString(): string {
    return `${this.toDb()} ${this.currency}`;
  }

  toJSON(): { amount: string; currency: string } {
    return { amount: this.toDb(), currency: this.currency };
  }

  static sum(items: readonly Money[], currency: string): Money {
    return items.reduce((acc, m) => acc.plus(m), Money.zero(currency));
  }
}

export { Decimal };
