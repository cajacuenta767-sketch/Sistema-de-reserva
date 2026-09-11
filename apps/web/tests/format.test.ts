import { describe, expect, it } from 'vitest';
import { amount, money, number, percent } from '@/lib/format';

describe('money', () => {
  it('el peso colombiano se presenta sin decimales', () => {
    // Se contabiliza con dos decimales, pero mostrar "$ 1.234.567,00" en una
    // tabla de facturas es ruido: en Colombia nadie escribe los centavos.
    expect(money({ amount: '1234567.00', currency: 'COP' })).toMatch(/1\.234\.567/);
    expect(money({ amount: '1234567.00', currency: 'COP' })).not.toMatch(/,00/);
  });

  it('el dólar sí los lleva', () => {
    expect(money({ amount: '1234.50', currency: 'USD' })).toMatch(/1\.234,50/);
  });

  it('un importe ausente se muestra como raya, no como cero', () => {
    // Un cero y un "no hay dato" significan cosas distintas en contabilidad.
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
  });

  it('lee la cadena exacta que devuelve la API sin perder magnitud', () => {
    expect(money({ amount: '99999999999.99', currency: 'USD' })).toMatch(/99\.999\.999\.999,99/);
  });
});

describe('amount y number', () => {
  it('formatea sin símbolo de moneda', () => {
    expect(amount('1234.5')).toBe('1.234,50');
    expect(amount('1234.5', 0)).toBe('1.235');
    expect(amount(null)).toBe('—');
  });

  it('number agrupa millares', () => {
    expect(number(1234567)).toBe('1.234.567');
    expect(number(null)).toBe('—');
  });
});

describe('percent', () => {
  it('recibe el porcentaje, no la fracción', () => {
    // Se pasa 19, no 0.19: es lo que devuelve la API para un IVA del 19 %.
    // El espacio antes del símbolo lo decide el locale, así que no se fija aquí.
    expect(percent(19)).toMatch(/^19\s?%$/);
    expect(percent(2.5, 1)).toMatch(/^2,5\s?%$/);
    expect(percent(null)).toBe('—');
  });
});
