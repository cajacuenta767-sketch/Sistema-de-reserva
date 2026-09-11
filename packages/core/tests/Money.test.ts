import { describe, expect, it } from 'vitest';
import { Money } from '../src/money/Money.js';

describe('Money', () => {
  it('no pierde precisión donde el float sí la pierde', () => {
    const a = Money.of('0.1', 'USD');
    const b = Money.of('0.2', 'USD');
    expect(a.plus(b).toDb()).toBe('0.30'); // 0.1 + 0.2 === 0.30000000000000004 en float
  });

  it('lee un NUMERIC de PostgreSQL sin pérdida', () => {
    const m = Money.fromDb('1234567890123.4567', 'COP');
    expect(m.toDb(4)).toBe('1234567890123.4567');
  });

  it('rechaza operar monedas distintas', () => {
    expect(() => Money.of(1, 'COP').plus(Money.of(1, 'USD'))).toThrow(/monedas distintas/);
  });

  it('redondea con la escala de la moneda', () => {
    expect(Money.of('1.005', 'USD').round().toDb()).toBe('1.01'); // media al alza
    expect(Money.of('1234.56', 'CLP').round().toDb()).toBe('1235'); // el peso chileno no tiene decimales
  });

  describe('allocate', () => {
    it('reparte sin perder ni un centavo', () => {
      const parts = Money.of('100.00', 'USD').allocate([1, 1, 1]);
      expect(parts.map((p) => p.toDb())).toEqual(['33.34', '33.33', '33.33']);
      expect(Money.sum(parts, 'USD').toDb()).toBe('100.00');
    });

    it('prorratea un descuento por pesos distintos', () => {
      const parts = Money.of('10.00', 'USD').allocate(['60', '30', '10']);
      expect(parts.map((p) => p.toDb())).toEqual(['6.00', '3.00', '1.00']);
      expect(Money.sum(parts, 'USD').toDb()).toBe('10.00');
    });

    it('reparte importes negativos conservando el total', () => {
      const parts = Money.of('-100.00', 'USD').allocate([1, 1, 1]);
      expect(Money.sum(parts, 'USD').toDb()).toBe('-100.00');
    });

    it('devuelve ceros si todos los pesos son cero', () => {
      const parts = Money.of('50.00', 'USD').allocate([0, 0]);
      expect(Money.sum(parts, 'USD').isZero()).toBe(true);
    });
  });

  it('convierte de moneda sin redondear por el camino', () => {
    const usd = Money.of('100', 'USD');
    const cop = usd.convert('COP', '4012.35');
    expect(cop.currency).toBe('COP');
    expect(cop.toDb()).toBe('401235.00');
  });
});
