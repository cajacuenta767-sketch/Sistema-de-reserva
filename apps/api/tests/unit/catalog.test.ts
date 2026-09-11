import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UOMS,
  assertRepresentable,
  convert,
  type Quantity,
} from '../../src/modules/catalog/domain/Uom.js';
import {
  addTax,
  bestTier,
  extractTax,
  marginPercent,
  resolvePrice,
  roundToMultiple,
  type PriceListRef,
} from '../../src/modules/catalog/domain/Pricing.js';
import {
  assertConsistent,
  assertNotOwnDescendant,
  categoryPath,
  normalizeSku,
  skuFromName,
  variantName,
} from '../../src/modules/catalog/domain/Product.js';
import { COLOMBIAN_TAXES, UVT_2026 } from '../../src/modules/catalog/domain/ColombianTaxes.js';
import { Decimal } from '@erp/core';

const uom = (code: string): Quantity['uom'] => {
  const seed = DEFAULT_UOMS.find((u) => u.code === code);
  if (!seed) throw new Error(`unidad de prueba inexistente: ${code}`);
  return { id: code, code: seed.code, dimension: seed.dimension, factor: seed.factor, precision: seed.precision };
};

describe('conversión de unidades', () => {
  it('convierte cajas a unidades', () => {
    expect(convert({ amount: '3', uom: uom('CJ12') }, uom('UND'))).toBe('36');
  });

  it('convierte unidades a cajas redondeando hacia arriba', () => {
    // 20 unidades no llenan dos cajas, pero para despacharlas hacen falta dos.
    // Redondear hacia abajo dejaría 8 unidades que el sistema no sabría mover.
    expect(convert({ amount: '20', uom: uom('UND') }, uom('CJ12'))).toBe('2');
  });

  it('convierte kilos a libras con el factor real', () => {
    // 1 kg = 1000 g; 1 lb = 453,592 g → 2,2046 lb, que redondeado a 3 da 2,205.
    expect(convert({ amount: '1', uom: uom('KG') }, uom('LB'))).toBe('2.205');
  });

  it('no convierte entre dimensiones distintas', () => {
    // El caso que justifica que la dimensión exista: sin ella esto devolvería
    // un número perfectamente plausible y acabaría en una factura.
    expect(() => convert({ amount: '5', uom: uom('KG') }, uom('M'))).toThrow(/miden cosas distintas/);
  });

  it('devuelve la misma cantidad si la unidad no cambia', () => {
    expect(convert({ amount: '7.5', uom: uom('KG') }, uom('KG'))).toBe('7.5');
  });

  it('rechaza fracciones en unidades discretas', () => {
    expect(() => assertRepresentable('2.5', uom('UND'))).toThrow(/no admite fracciones/);
    expect(() => assertRepresentable('2.5', uom('KG'))).not.toThrow();
  });

  it('cada dimensión tiene exactamente una unidad base con factor 1', () => {
    const dimensions = new Set(DEFAULT_UOMS.map((u) => u.dimension));
    for (const dimension of dimensions) {
      const bases = DEFAULT_UOMS.filter((u) => u.dimension === dimension && u.isBase);
      expect(bases, dimension).toHaveLength(1);
      expect(bases[0]?.factor, dimension).toBe('1');
    }
  });

  it('todas las unidades traen su código DIAN', () => {
    // Sin él, la primera factura electrónica que se emita es rechazada.
    expect(DEFAULT_UOMS.filter((u) => !u.dianCode)).toHaveLength(0);
  });
});

describe('impuestos colombianos sembrados', () => {
  it('trae IVA 19, 5, 0 y excluido', () => {
    const vat = COLOMBIAN_TAXES.filter((t) => t.kind === 'VAT').map((t) => t.code);
    expect(vat).toEqual(['IVA19', 'IVA5', 'IVA0', 'IVAEXC']);
  });

  it('distingue exento de excluido aunque los dos sean 0 %', () => {
    // No es un matiz: el exento da derecho a descontar el IVA de las compras y
    // el excluido no. Confundirlos falsea la declaración.
    const exento = COLOMBIAN_TAXES.find((t) => t.code === 'IVA0');
    const excluido = COLOMBIAN_TAXES.find((t) => t.code === 'IVAEXC');
    expect(exento?.rate).toBe('0');
    expect(excluido?.rate).toBe('0');
    expect(exento?.dianTaxCode).toBe('01');
    expect(excluido?.dianTaxCode).toBeNull();
  });

  it('las retenciones solo aplican en compras y llevan base mínima en UVT', () => {
    const withholdings = COLOMBIAN_TAXES.filter((t) => t.isWithholding);
    expect(withholdings.length).toBeGreaterThan(5);
    for (const tax of withholdings) {
      expect(tax.appliesTo, tax.code).toBe('PURCHASE');
      expect(tax.kind, tax.code).toMatch(/^WITHHOLDING_/);
    }
    // Compras: 27 UVT. Si la UVT del año cambia, la base cambia sola.
    expect(COLOMBIAN_TAXES.find((t) => t.code === 'RTF-COMP')?.minBase).toBe(String(27 * UVT_2026));
  });

  it('el ReteICA se expresa en porcentaje, no por mil', () => {
    // La tarifa municipal se publica como "11,04 por mil". Guardarla tal cual
    // cobraría un 11 % en vez de un 1,1 %: diez veces de más.
    expect(COLOMBIAN_TAXES.find((t) => t.code === 'RTICA-COM')?.rate).toBe('1.104');
  });

  it('ningún código se repite', () => {
    const codes = COLOMBIAN_TAXES.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('precio con impuesto incluido', () => {
  it('extrae el IVA de un precio de vitrina', () => {
    // La etiqueta dice 11.900. La base es 10.000 y el IVA 1.900.
    expect(extractTax('11900', '19')).toEqual({ base: '10000.0000', tax: '1900.0000' });
  });

  it('calcular el 19 % sobre el precio con IVA daría otro número', () => {
    // Es el error que justifica que exista `extractTax`: 11.900 × 19 % = 2.261,
    // y la factura no cuadraría con la etiqueta.
    const mal = new Decimal('11900').times('0.19').toFixed(0);
    expect(mal).toBe('2261');
    expect(extractTax('11900', '19').tax).toBe('1900.0000');
  });

  it('añadir y extraer son inversas', () => {
    const gross = addTax('10000', '19');
    expect(gross).toBe('11900.0000');
    expect(extractTax(gross, '19').base).toBe('10000.0000');
  });
});

describe('resolución de precio', () => {
  const list = (over: Partial<PriceListRef> & { id: string; name: string }): PriceListRef => ({
    mode: 'FIXED',
    basedOnId: null,
    adjustmentPercent: '0',
    rounding: '0',
    includesTax: false,
    currencyCode: 'COP',
    validFrom: null,
    validTo: null,
    isActive: true,
    ...over,
  });

  it('sin listas usa el precio del producto', () => {
    const result = resolvePrice({ basePrice: '15000', quantity: '1', on: '2026-03-10', chain: [], tiers: [] });
    expect(result.price).toBe('15000.0000');
    expect(result.sourceListId).toBeNull();
  });

  it('una lista fija gana sobre el precio del producto', () => {
    const mayorista = list({ id: 'L1', name: 'Mayorista' });
    const result = resolvePrice({
      basePrice: '15000',
      quantity: '1',
      on: '2026-03-10',
      chain: [mayorista],
      tiers: [{ priceListId: 'L1', minQuantity: '1', price: '12000' }],
    });
    expect(result.price).toBe('12000.0000');
    expect(result.sourceLabel).toBe('Mayorista');
  });

  it('aplica la escala por cantidad que corresponda', () => {
    const tiers = [
      { priceListId: 'L1', minQuantity: '1', price: '12000' },
      { priceListId: 'L1', minQuantity: '10', price: '10000' },
      { priceListId: 'L1', minQuantity: '100', price: '8500' },
    ];
    const at = (quantity: string): string =>
      resolvePrice({
        basePrice: '15000',
        quantity,
        on: '2026-03-10',
        chain: [list({ id: 'L1', name: 'Mayorista' })],
        tiers,
      }).price;

    expect(at('5')).toBe('12000.0000');
    expect(at('10')).toBe('10000.0000'); // el escalón incluye su propia cantidad
    expect(at('99')).toBe('10000.0000');
    expect(at('100')).toBe('8500.0000');
  });

  it('una lista derivada aplica su porcentaje sobre la base', () => {
    const general = list({ id: 'L1', name: 'General' });
    const distribuidores = list({
      id: 'L2',
      name: 'Distribuidores',
      mode: 'DERIVED',
      basedOnId: 'L1',
      adjustmentPercent: '15',
    });
    const result = resolvePrice({
      basePrice: '15000',
      quantity: '1',
      on: '2026-03-10',
      chain: [distribuidores, general],
      tiers: [{ priceListId: 'L1', minQuantity: '1', price: '20000' }],
    });
    // 20.000 de la lista general, menos el 15 % de la derivada.
    expect(result.price).toBe('17000.0000');
    expect(result.sourceLabel).toBe('General');
  });

  it('un precio explícito en la derivada gana sobre su propio porcentaje', () => {
    // La excepción configurada a mano es una decisión comercial; recalcularla
    // con la fórmula anularía justo lo que alguien quiso dejar distinto.
    const general = list({ id: 'L1', name: 'General' });
    const distribuidores = list({
      id: 'L2',
      name: 'Distribuidores',
      mode: 'DERIVED',
      basedOnId: 'L1',
      adjustmentPercent: '15',
    });
    const result = resolvePrice({
      basePrice: '15000',
      quantity: '1',
      on: '2026-03-10',
      chain: [distribuidores, general],
      tiers: [
        { priceListId: 'L1', minQuantity: '1', price: '20000' },
        { priceListId: 'L2', minQuantity: '1', price: '16500' },
      ],
    });
    expect(result.price).toBe('16500.0000');
    expect(result.sourceLabel).toBe('Distribuidores');
  });

  it('ignora una lista fuera de vigencia', () => {
    const promo = list({ id: 'L1', name: 'Promo enero', validFrom: '2026-01-01', validTo: '2026-01-31' });
    const result = resolvePrice({
      basePrice: '15000',
      quantity: '1',
      on: '2026-03-10',
      chain: [promo],
      tiers: [{ priceListId: 'L1', minQuantity: '1', price: '9000' }],
    });
    expect(result.price).toBe('15000.0000');
    expect(result.sourceListId).toBeNull();
  });

  it('usa la fecha del documento, no la de hoy', () => {
    const promo = list({ id: 'L1', name: 'Promo enero', validFrom: '2026-01-01', validTo: '2026-01-31' });
    const input = {
      basePrice: '15000',
      quantity: '1',
      chain: [promo],
      tiers: [{ priceListId: 'L1', minQuantity: '1', price: '9000' }],
    };
    // Refacturar enero en marzo tiene que dar el precio de enero.
    expect(resolvePrice({ ...input, on: '2026-01-15' }).price).toBe('9000.0000');
    expect(resolvePrice({ ...input, on: '2026-03-10' }).price).toBe('15000.0000');
  });

  it('redondea al múltiplo de la lista', () => {
    const result = resolvePrice({
      basePrice: '23847',
      quantity: '1',
      on: '2026-03-10',
      chain: [list({ id: 'L1', name: 'Detal', rounding: '100' })],
      tiers: [],
    });
    expect(result.price).toBe('23800.0000');
  });

  it('un descuento mayor que el 100 % no produce un precio negativo', () => {
    const absurda = list({
      id: 'L2',
      name: 'Mal configurada',
      mode: 'DERIVED',
      basedOnId: 'L1',
      adjustmentPercent: '120',
    });
    const result = resolvePrice({
      basePrice: '10000',
      quantity: '1',
      on: '2026-03-10',
      chain: [absurda, list({ id: 'L1', name: 'General' })],
      tiers: [],
    });
    expect(result.price).toBe('0.0000');
  });

  it('rechaza una cantidad de cero', () => {
    expect(() =>
      resolvePrice({ basePrice: '10000', quantity: '0', on: '2026-03-10', chain: [], tiers: [] }),
    ).toThrow(/mayor que cero/);
  });

  it('normaliza el escalón aplicado para mostrarlo', () => {
    // La base devuelve NUMERIC(19,6) como texto: "50.000000" en la pantalla
    // sería un número que nadie escribió.
    const result = resolvePrice({
      basePrice: '15000',
      quantity: '60',
      on: '2026-03-10',
      chain: [list({ id: 'L1', name: 'Mayorista' })],
      tiers: [{ priceListId: 'L1', minQuantity: '50.000000', price: '9500' }],
    });
    expect(result.appliedTier).toBe('50');
  });

  it('bestTier elige el escalón mayor que no supere la cantidad', () => {
    const tiers = [
      { priceListId: 'L1', minQuantity: '1', price: '100' },
      { priceListId: 'L1', minQuantity: '50', price: '80' },
      { priceListId: 'L2', minQuantity: '10', price: '60' },
    ];
    expect(bestTier(tiers, 'L1', '60')?.price).toBe('80');
    expect(bestTier(tiers, 'L2', '5')).toBeNull();
  });

  it('roundToMultiple con 0 no redondea', () => {
    expect(roundToMultiple(new Decimal('23847.5'), '0').toString()).toBe('23847.5');
  });
});

describe('margen', () => {
  it('se calcula sobre el precio de venta', () => {
    expect(marginPercent('10000', '6000')).toBe('40.00');
  });

  it('es negativo si se vende bajo el costo', () => {
    expect(marginPercent('5000', '6000')).toBe('-20.00');
  });

  it('no divide por cero', () => {
    expect(marginPercent('0', '6000')).toBeNull();
  });
});

describe('producto', () => {
  it('normaliza el SKU', () => {
    expect(normalizeSku('  abc-1  ')).toBe('ABC-1');
    expect(normalizeSku('abc   1')).toBe('ABC 1');
  });

  it('genera un SKU legible desde el nombre', () => {
    expect(skuFromName('Camisa de algodón', 7)).toBe('CAMISA-DE-AL-0007');
    expect(skuFromName('☕', 1)).toBe('PROD-0001');
  });

  it('un servicio no puede llevar existencias', () => {
    expect(() =>
      assertConsistent({
        kind: 'SERVICE',
        trackInventory: true,
        tracking: 'NONE',
        isSellable: true,
        isPurchasable: false,
      }),
    ).toThrow(/no lleva existencias/);
  });

  it('no se controlan lotes de lo que no se inventaría', () => {
    expect(() =>
      assertConsistent({
        kind: 'GOOD',
        trackInventory: false,
        tracking: 'LOT',
        isSellable: true,
        isPurchasable: true,
      }),
    ).toThrow(/llevar existencias/);
  });

  it('un producto que ni se vende ni se compra no sirve', () => {
    expect(() =>
      assertConsistent({
        kind: 'GOOD',
        trackInventory: true,
        tracking: 'NONE',
        isSellable: false,
        isPurchasable: false,
      }),
    ).toThrow(/no sirve/);
  });

  it('nombra la variante con sus atributos', () => {
    expect(variantName('Camisa', { color: 'azul', talla: 'M' })).toBe('Camisa · azul / M');
    expect(variantName('Camisa', {})).toBe('Camisa');
  });
});

describe('árbol de categorías', () => {
  it('construye la ruta desde el padre', () => {
    expect(categoryPath(null, 'Bebidas')).toBe('Bebidas');
    expect(categoryPath('Bebidas', 'Gaseosas')).toBe('Bebidas / Gaseosas');
  });

  it('impide mover una categoría dentro de su propia descendencia', () => {
    expect(() => assertNotOwnDescendant('Bebidas', 'Bebidas / Gaseosas')).toThrow(/ciclo/);
    expect(() => assertNotOwnDescendant('Bebidas', 'Bebidas')).toThrow(/ciclo/);
  });

  it('permite moverla a otra rama', () => {
    expect(() => assertNotOwnDescendant('Bebidas / Gaseosas', 'Alimentos')).not.toThrow();
    // "Bebidas frías" empieza por "Bebidas" pero NO es descendiente suya: sin
    // comparar el separador, este movimiento legítimo quedaría bloqueado.
    expect(() => assertNotOwnDescendant('Bebidas', 'Bebidas frías')).not.toThrow();
  });
});
