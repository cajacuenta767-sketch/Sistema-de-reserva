import { describe, expect, it } from 'vitest';
import { AppError, Decimal, Money } from '@erp/core';
import {
  allocateLandedCost,
  applyCount,
  applyIssue,
  applyReceipt,
  assertEnoughStock,
  availableOf,
  emptyState,
  stockValue,
  type StockState,
} from '../../src/modules/inventory/domain/Costing.js';
import {
  assertLotBelongs,
  assertLotNotExpired,
  assertSignMatchesKind,
  assertTracksInventory,
  isBidirectional,
  isInbound,
  isOutbound,
  lotsInPickingOrder,
} from '../../src/modules/inventory/domain/StockMove.js';
import {
  assertWithinOrder,
  deriveOrderStatus,
  pendingOf,
  threeWayMatch,
} from '../../src/modules/inventory/domain/Purchasing.js';

const state = (quantity: string, averageCost: string): StockState => ({
  quantity: new Decimal(quantity),
  averageCost: new Decimal(averageCost),
});

// ═══════════════════════════════════════════════════════════════════════════
describe('costo promedio ponderado', () => {
  it('el oro del inventario: tres compras y dos ventas, verificado a mano', () => {
    /*
     * Compra 100 a $1.000 → 100 unidades, promedio $1.000, valor $100.000
     * Compra  50 a $1.300 → 150 unidades
     *     (100×1.000 + 50×1.300) / 150 = 165.000 / 150 = $1.100
     * Vende   60 al promedio $1.100 → costo de ventas $66.000
     *     quedan 90 unidades, promedio SIGUE en $1.100, valor $99.000
     * Compra 150 a $1.500 → 240 unidades
     *     (90×1.100 + 150×1.500) / 240 = 324.000 / 240 = $1.350
     * Vende  200 al promedio $1.350 → costo de ventas $270.000
     *     quedan 40 unidades, valor $54.000
     */
    let s = emptyState();

    const c1 = applyReceipt(s, '100', '1000');
    expect(c1.balanceAfter.toFixed(0)).toBe('100');
    expect(c1.averageAfter.toFixed(2)).toBe('1000.00');
    s = { quantity: c1.balanceAfter, averageCost: c1.averageAfter };

    const c2 = applyReceipt(s, '50', '1300');
    expect(c2.balanceAfter.toFixed(0)).toBe('150');
    expect(c2.averageAfter.toFixed(2)).toBe('1100.00');
    s = { quantity: c2.balanceAfter, averageCost: c2.averageAfter };

    const v1 = applyIssue(s, '60');
    expect(v1.unitCost.toFixed(2)).toBe('1100.00');
    expect(v1.totalCost.toFixed(2)).toBe('-66000.00');
    expect(v1.balanceAfter.toFixed(0)).toBe('90');
    // Vender NO cambia el promedio: es la propiedad que define el método.
    expect(v1.averageAfter.toFixed(2)).toBe('1100.00');
    s = { quantity: v1.balanceAfter, averageCost: v1.averageAfter };

    const c3 = applyReceipt(s, '150', '1500');
    expect(c3.balanceAfter.toFixed(0)).toBe('240');
    expect(c3.averageAfter.toFixed(2)).toBe('1350.00');
    s = { quantity: c3.balanceAfter, averageCost: c3.averageAfter };

    const v2 = applyIssue(s, '200');
    expect(v2.totalCost.toFixed(2)).toBe('-270000.00');
    expect(v2.balanceAfter.toFixed(0)).toBe('40');
    s = { quantity: v2.balanceAfter, averageCost: v2.averageAfter };

    expect(stockValue(s, 'COP').toDb(2)).toBe('54000.00');
  });

  it('pondera por valor, no por precio', () => {
    // 1.000 unidades a $10 y 1 unidad a $1.000. Promediar los PRECIOS daría
    // $505 y multiplicaría por cincuenta el costo de toda la bodega.
    const s = applyReceipt(emptyState(), '1000', '10');
    const after = applyReceipt({ quantity: s.balanceAfter, averageCost: s.averageAfter }, '1', '1000');
    // (10.000 + 1.000) / 1.001 = 10,99
    expect(after.averageAfter.toFixed(2)).toBe('10.99');
  });

  it('con existencias negativas, una entrada FIJA el costo en vez de promediarlo', () => {
    // Se vendió lo que aún no había llegado: el promedio anterior no significa
    // nada, y promediar contra una base negativa da costos negativos que
    // después aparecen como utilidades imposibles.
    const negativo = state('-10', '500');
    const entrada = applyReceipt(negativo, '100', '1200');
    expect(entrada.averageAfter.toFixed(2)).toBe('1200.00');
    expect(entrada.averageAfter.isNegative()).toBe(false);
    expect(entrada.balanceAfter.toFixed(0)).toBe('90');
  });

  it('rechaza entradas de cero, negativas o con costo negativo', () => {
    expect(() => applyReceipt(emptyState(), '0', '100')).toThrow(AppError);
    expect(() => applyReceipt(emptyState(), '-5', '100')).toThrow(/positiva/);
    expect(() => applyReceipt(emptyState(), '5', '-100')).toThrow(/negativo/);
  });

  it('la salida se guarda con la cantidad en negativo', () => {
    const salida = applyIssue(state('10', '1000'), '4');
    expect(salida.quantity.toFixed(0)).toBe('-4');
    expect(salida.balanceAfter.toFixed(0)).toBe('6');
  });
});

describe('ajuste por conteo', () => {
  it('lleva las existencias a lo contado sin tocar el costo', () => {
    const ajuste = applyCount(state('100', '1250'), '97');
    expect(ajuste?.quantity.toFixed(0)).toBe('-3');
    expect(ajuste?.balanceAfter.toFixed(0)).toBe('97');
    // Un conteo mide unidades, no precios.
    expect(ajuste?.averageAfter.toFixed(2)).toBe('1250.00');
    expect(ajuste?.totalCost.toFixed(2)).toBe('-3750.00');
  });

  it('lo que sobra entra al promedio vigente', () => {
    const ajuste = applyCount(state('100', '1250'), '104');
    expect(ajuste?.quantity.toFixed(0)).toBe('4');
    expect(ajuste?.totalCost.toFixed(2)).toBe('5000.00');
  });

  it('sin diferencia no hay movimiento: un ajuste de cero ensucia el kardex', () => {
    expect(applyCount(state('100', '1250'), '100')).toBeNull();
  });

  it('un conteo negativo no existe', () => {
    expect(() => applyCount(state('100', '1250'), '-1')).toThrow(/negativo/);
  });
});

describe('disponibilidad', () => {
  const nivel = { quantity: new Decimal('50'), reserved: new Decimal('20') };

  it('disponible es existencias menos reservado', () => {
    expect(availableOf(nivel).toFixed(0)).toBe('30');
  });

  it('lo reservado no se puede prometer dos veces', () => {
    expect(() => assertEnoughStock(nivel, '40', 'Caja de producto', false)).toThrow(
      /20,?\.?00 están reservadas|20\.00 están reservadas/,
    );
    expect(() => assertEnoughStock(nivel, '30', 'Caja de producto', false)).not.toThrow();
  });

  it('el mensaje dice cuánto hay, no solo que no alcanza', () => {
    try {
      assertEnoughStock(nivel, '40', 'Caja de producto', false);
    } catch (e) {
      expect(AppError.is(e) && e.message).toContain('30.00 disponibles');
      expect(AppError.is(e) && e.message).toContain('Caja de producto');
    }
  });

  it('con stock negativo permitido, no bloquea', () => {
    expect(() => assertEnoughStock(nivel, '999', 'Caja', true)).not.toThrow();
  });
});

describe('costos indirectos de importación', () => {
  it('se reparten por valor, no por unidades', () => {
    // 1.000 tornillos de $1 ($1.000) y 10 motores de $9.000 ($90.000).
    // Flete de $9.100. Por unidades, casi todo iría a los tornillos y cada uno
    // costaría veinte veces más de lo que vale.
    const [tornillos, motores] = allocateLandedCost(['1000', '90000'], Money.of('9100', 'COP'));
    expect(tornillos?.toDb(2)).toBe('100.00');
    expect(motores?.toDb(2)).toBe('9000.00');
  });

  it('no pierde ni un centavo al repartir', () => {
    const partes = allocateLandedCost(['1', '1', '1'], Money.of('100', 'COP'));
    const suma = partes.reduce((a, p) => a.plus(p), Money.zero('COP'));
    expect(suma.toDb(2)).toBe('100.00');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('tipos de movimiento', () => {
  it('clasifica cada tipo por su sentido', () => {
    expect(isInbound('RECEIPT')).toBe(true);
    expect(isOutbound('ISSUE')).toBe(true);
    // El ajuste y el conteo van en los dos sentidos.
    expect(isBidirectional('ADJUSTMENT')).toBe(true);
    expect(isBidirectional('COUNT')).toBe(true);
    expect(isBidirectional('RECEIPT')).toBe(false);
  });

  it('el signo y el tipo tienen que decir lo mismo', () => {
    expect(() => assertSignMatchesKind('RECEIPT', -5)).toThrow(/positivo/);
    expect(() => assertSignMatchesKind('ISSUE', 5)).toThrow(/negativo/);
    expect(() => assertSignMatchesKind('RECEIPT', 5)).not.toThrow();
    expect(() => assertSignMatchesKind('ISSUE', -5)).not.toThrow();
    expect(() => assertSignMatchesKind('ADJUSTMENT', -5)).not.toThrow();
    expect(() => assertSignMatchesKind('ADJUSTMENT', 5)).not.toThrow();
    expect(() => assertSignMatchesKind('ADJUSTMENT', 0)).toThrow(/no es un movimiento/);
  });

  it('un servicio no tiene existencias', () => {
    expect(() =>
      assertTracksInventory({ name: 'Instalación', kind: 'SERVICE', trackInventory: false }),
    ).toThrow(/es un servicio/);
    expect(() =>
      assertTracksInventory({ name: 'Caja', kind: 'GOOD', trackInventory: true }),
    ).not.toThrow();
  });
});

describe('lotes', () => {
  const lote = { id: 'l1', code: 'L-2026-04', productId: 'p1', expiresOn: '2026-12-31' };

  it('un lote pertenece a su producto y no a otro', () => {
    expect(() => assertLotBelongs(lote, 'p2', false, 'Jarabe')).toThrow(/no pertenece/);
    expect(() => assertLotBelongs(lote, 'p1', true, 'Jarabe')).not.toThrow();
  });

  it('un producto por lotes exige lote', () => {
    expect(() => assertLotBelongs(null, 'p1', true, 'Jarabe')).toThrow(/indica cuál/);
    expect(() => assertLotBelongs(null, 'p1', false, 'Caja')).not.toThrow();
  });

  it('un lote vencido no se despacha', () => {
    expect(() => assertLotNotExpired(lote, '2027-01-05')).toThrow(/venció el 2026-12-31/);
    expect(() => assertLotNotExpired(lote, '2026-06-01')).not.toThrow();
    expect(() => assertLotNotExpired(null, '2027-01-05')).not.toThrow();
  });

  it('sale primero el que vence antes, no el que entró antes', () => {
    // FEFO, no FIFO: un lote comprado ayer puede vencer antes que uno de hace
    // un mes, y sacar el más antiguo primero lo dejaría caducar en la estantería.
    const orden = lotsInPickingOrder([
      { code: 'VIEJO', expiresOn: '2027-06-01', createdAt: '2026-01-01' },
      { code: 'NUEVO', expiresOn: '2026-07-01', createdAt: '2026-05-01' },
      { code: 'SIN-FECHA', expiresOn: null, createdAt: '2025-01-01' },
    ]);
    expect(orden.map((l) => l.code)).toEqual(['NUEVO', 'VIEJO', 'SIN-FECHA']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('ciclo de compra', () => {
  it('el estado se deriva de lo recibido', () => {
    const lines = [
      { quantity: '10', received: '0' },
      { quantity: '5', received: '0' },
    ];
    expect(deriveOrderStatus('SENT', lines)).toBe('SENT');
    expect(deriveOrderStatus('SENT', [{ quantity: '10', received: '4' }])).toBe('PARTIAL');
    expect(deriveOrderStatus('SENT', [{ quantity: '10', received: '10' }])).toBe('RECEIVED');
  });

  it('borrador y cancelada son decisiones, no hechos: no las cambia lo recibido', () => {
    expect(deriveOrderStatus('DRAFT', [{ quantity: '10', received: '10' }])).toBe('DRAFT');
    expect(deriveOrderStatus('CANCELLED', [{ quantity: '10', received: '10' }])).toBe('CANCELLED');
  });

  it('lo pendiente nunca es negativo aunque llegue de más', () => {
    expect(pendingOf({ quantity: '10', received: '4' }).toFixed(0)).toBe('6');
    expect(pendingOf({ quantity: '10', received: '12' }).toFixed(0)).toBe('0');
  });

  it('recibir un poco de más se permite; mucho de más, no', () => {
    // Los proveedores despachan por empaque: una caja de 11 cuando se pidieron
    // 10 no debería obligar a modificar la orden.
    expect(() => assertWithinOrder({ quantity: '10', received: '0' }, '11', 'Caja')).not.toThrow();
    expect(() => assertWithinOrder({ quantity: '10', received: '0' }, '12', 'Caja')).toThrow(
      /tolerancia/,
    );
  });

  it('el contraste de tres vías detecta lo que se factura sin recibir', () => {
    const match = threeWayMatch({
      ordered: '10',
      received: '8',
      billed: '10',
      description: 'Caja de producto',
    });
    expect(match.matches).toBe(false);
    expect(match.issues[0]).toContain('Facturan 10.00');
    expect(match.issues[0]).toContain('solo llegaron 8.00');
    expect(match.issues[1]).toContain('faltan 2.00 por llegar');
  });

  it('cuando los tres documentos coinciden no hay nada que revisar', () => {
    const match = threeWayMatch({
      ordered: '10',
      received: '10',
      billed: '10',
      description: 'Caja',
    });
    expect(match.matches).toBe(true);
    expect(match.issues).toHaveLength(0);
  });
});
