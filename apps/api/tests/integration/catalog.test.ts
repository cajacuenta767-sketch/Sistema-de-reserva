import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asTenant,
  inviteMember,
  makeTestApp,
  registerOrganization,
  type Account,
  type TestApp,
} from '../helpers.js';

let t: TestApp;
let owner: Account;

beforeAll(async () => {
  t = await makeTestApp();
  owner = await registerOrganization(t, { organizationName: 'Distribuidora Andina' });
});
afterAll(async () => {
  await t.close();
});

describe('siembra al crear la empresa', () => {
  it('deja unidades, impuestos, categorías y una lista de precios listas para usar', async () => {
    // Una empresa recién creada tiene que poder registrar un producto sin pasar
    // antes por cuatro pantallas de configuración.
    const uoms = await owner.as('get', '/api/v1/uoms').expect(200);
    expect(uoms.body.items.length).toBeGreaterThan(15);
    expect(uoms.body.items.map((u: { code: string }) => u.code)).toContain('UND');

    const taxes = await owner.as('get', '/api/v1/taxes').expect(200);
    const codes = taxes.body.items.map((x: { code: string }) => x.code);
    expect(codes).toContain('IVA19');
    expect(codes).toContain('INC8');
    expect(codes).toContain('RTF-SERV');

    const categories = await owner.as('get', '/api/v1/product-categories').expect(200);
    expect(categories.body.items.map((c: { name: string }) => c.name)).toEqual(['Productos', 'Servicios']);

    const lists = await owner.as('get', '/api/v1/price-lists').expect(200);
    expect(lists.body.items).toHaveLength(1);
    expect(lists.body.items[0]).toMatchObject({ name: 'General', isDefault: true, kind: 'SALE' });
  });

  it('cada dimensión tiene su unidad base con factor 1', async () => {
    const { body } = await owner.as('get', '/api/v1/uoms').expect(200);
    const bases = body.items.filter((u: { isBase: boolean }) => u.isBase);
    const dimensions = new Set(body.items.map((u: { dimension: string }) => u.dimension));
    expect(bases).toHaveLength(dimensions.size);
    for (const base of bases) expect(Number(base.factor)).toBe(1);
  });

  it('la siembra no se filtra a otra empresa', async () => {
    // Las unidades e impuestos son datos de la organización, no globales: si RLS
    // fallara, dos empresas compartirían tarifas de IVA.
    const other = await registerOrganization(t, { organizationName: 'Otra empresa' });
    const mine = await owner.as('get', '/api/v1/uoms').expect(200);
    const theirs = await other.as('get', '/api/v1/uoms').expect(200);

    expect(theirs.body.items.length).toBe(mine.body.items.length);
    const mineIds = new Set(mine.body.items.map((u: { id: string }) => u.id));
    for (const u of theirs.body.items) expect(mineIds.has(u.id)).toBe(false);
  });
});

describe('crear productos', () => {
  it('genera el SKU si no se da, y asigna IVA 19 por defecto', async () => {
    const response = await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Camisa de algodón', salePrice: '89900' })
      .expect(201);

    expect(response.body.sku).toMatch(/^CAMISA-DE-AL-\d{4}$/);
    expect(response.body.saleTaxId).not.toBeNull();
    expect(response.body.trackInventory).toBe(true);

    const detail = await owner.as('get', `/api/v1/products/${response.body.id}`).expect(200);
    expect(detail.body.saleTax.code).toBe('IVA19');
    expect(detail.body.uom.code).toBe('UND');
  });

  it('un servicio nace sin existencias y en horas', async () => {
    const response = await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Consultoría', kind: 'SERVICE', salePrice: '250000' })
      .expect(201);

    expect(response.body.trackInventory).toBe(false);
    const detail = await owner.as('get', `/api/v1/products/${response.body.id}`).expect(200);
    expect(detail.body.uom.code).toBe('HORA');
  });

  it('rechaza un servicio con existencias', async () => {
    const response = await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Servicio imposible', kind: 'SERVICE', trackInventory: true })
      .expect(422);
    expect(response.body.error.message).toMatch(/no lleva existencias/);
  });

  it('no admite dos productos con el mismo SKU', async () => {
    await owner.as('post', '/api/v1/products').send({ name: 'Uno', sku: 'REP-001' }).expect(201);
    const response = await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Otro', sku: 'rep-001' })
      .expect(409);
    // Normalizado: "rep-001" y "REP-001" son el mismo código.
    expect(response.body.error.message).toContain('REP-001');
    expect(response.body.error.message).toContain('Uno');
  });

  it('no admite dos códigos de barras iguales', async () => {
    await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Gaseosa 350', barcode: '7702001234567' })
      .expect(201);
    const response = await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Otra gaseosa', barcode: '7702001234567' })
      .expect(409);
    // El lector de la caja escogería uno al azar: el precio dejaría de ser predecible.
    expect(response.body.error.message).toContain('Gaseosa 350');
  });

  it('calcula el margen en la ficha', async () => {
    const created = await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Con margen', salePrice: '10000', purchasePrice: '6000' })
      .expect(201);
    const detail = await owner.as('get', `/api/v1/products/${created.body.id}`).expect(200);
    expect(detail.body.marginPercent).toBe('40.00');
  });

  it('rechaza una unidad de venta que mide otra cosa', async () => {
    const response = await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Incoherente', uomCode: 'KG', saleUomId: await uomId('M') })
      .expect(422);
    expect(response.body.error.message).toMatch(/no mide lo mismo/);
  });
});

describe('variantes', () => {
  it('se nombran con sus atributos y heredan el código del producto', async () => {
    const product = await owner
      .as('post', '/api/v1/products')
      .send({
        name: 'Camiseta',
        sku: 'CAM-BASE',
        variants: [
          { attributes: { color: 'azul', talla: 'M' } },
          { attributes: { color: 'rojo', talla: 'L' }, priceDelta: '5000' },
        ],
      })
      .expect(201);

    const detail = await owner.as('get', `/api/v1/products/${product.body.id}`).expect(200);
    expect(detail.body.variants).toHaveLength(2);
    expect(detail.body.variants.map((v: { name: string }) => v.name)).toEqual([
      'Camiseta · azul / M',
      'Camiseta · rojo / L',
    ]);
    expect(detail.body.variants.map((v: { sku: string }) => v.sku)).toEqual(['CAM-BASE-1', 'CAM-BASE-2']);
  });

  it('el listado cuenta las variantes sin descuadrar el total', async () => {
    // Con JOIN en vez de subconsulta, un producto con dos variantes contaría dos
    // veces y el total de la paginación mentiría.
    const list = await owner.as('get', '/api/v1/products?filter[sku]=CAM-BASE').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].variant_count).toBe(2);
  });
});

describe('categorías', () => {
  it('construye la ruta y cuenta los productos de toda la rama', async () => {
    const bebidas = await owner
      .as('post', '/api/v1/product-categories')
      .send({ name: 'Bebidas' })
      .expect(201);
    const gaseosas = await owner
      .as('post', '/api/v1/product-categories')
      .send({ name: 'Gaseosas', parentId: bebidas.body.id })
      .expect(201);

    expect(gaseosas.body.path).toBe('Bebidas / Gaseosas');
    expect(gaseosas.body.depth).toBe(1);

    await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Cola 1.5L', categoryId: gaseosas.body.id })
      .expect(201);

    const tree = await owner.as('get', '/api/v1/product-categories').expect(200);
    const node = tree.body.items.find((c: { id: string }) => c.id === bebidas.body.id);
    // La rama entera, no solo los hijos directos: si contara solo lo propio,
    // "Bebidas" mostraría 0 y el árbol parecería vacío justo donde está todo.
    expect(node.productCount).toBe(1);
  });

  it('renombrar una rama reescribe las rutas de su descendencia', async () => {
    const raiz = await owner.as('post', '/api/v1/product-categories').send({ name: 'Aseo' }).expect(201);
    const hijo = await owner
      .as('post', '/api/v1/product-categories')
      .send({ name: 'Jabones', parentId: raiz.body.id })
      .expect(201);
    await owner
      .as('post', '/api/v1/product-categories')
      .send({ name: 'Líquidos', parentId: hijo.body.id })
      .expect(201);

    await owner
      .as('patch', `/api/v1/product-categories/${raiz.body.id}`)
      .send({ name: 'Aseo y limpieza' })
      .expect(200);

    const tree = await owner.as('get', '/api/v1/product-categories').expect(200);
    const paths = tree.body.items.map((c: { path: string }) => c.path);
    expect(paths).toContain('Aseo y limpieza');
    expect(paths).toContain('Aseo y limpieza / Jabones');
    expect(paths).toContain('Aseo y limpieza / Jabones / Líquidos');
    expect(paths.some((p: string) => p.startsWith('Aseo /'))).toBe(false);
  });

  it('impide mover una categoría dentro de su propia descendencia', async () => {
    const padre = await owner.as('post', '/api/v1/product-categories').send({ name: 'Papelería' }).expect(201);
    const hijo = await owner
      .as('post', '/api/v1/product-categories')
      .send({ name: 'Cuadernos', parentId: padre.body.id })
      .expect(201);

    const response = await owner
      .as('patch', `/api/v1/product-categories/${padre.body.id}`)
      .send({ parentId: hijo.body.id })
      .expect(422);
    expect(response.body.error.message).toMatch(/ciclo/);
  });

  it('no borra una categoría con productos dentro', async () => {
    const categoria = await owner.as('post', '/api/v1/product-categories').send({ name: 'Con cosas' }).expect(201);
    await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Algo', categoryId: categoria.body.id })
      .expect(201);

    const response = await owner
      .as('delete', `/api/v1/product-categories/${categoria.body.id}`)
      .expect(422);
    expect(response.body.error.message).toMatch(/reasígnalos/);
  });

  it('rechaza una barra en el nombre', async () => {
    // La barra separa los niveles de la ruta: admitirla rompería el filtrado.
    await owner.as('post', '/api/v1/product-categories').send({ name: 'Uno / Otro' }).expect(400);
  });
});

describe('impuestos', () => {
  it('no borra un impuesto en uso, pero deja desactivarlo', async () => {
    const taxes = await owner.as('get', '/api/v1/taxes').expect(200);
    const iva19 = taxes.body.items.find((x: { code: string }) => x.code === 'IVA19');

    await owner.as('post', '/api/v1/products').send({ name: 'Con IVA', saleTaxId: iva19.id }).expect(201);

    const response = await owner.as('delete', `/api/v1/taxes/${iva19.id}`).expect(422);
    expect(response.body.error.message).toMatch(/Desactívalo/);

    await owner.as('patch', `/api/v1/taxes/${iva19.id}`).send({ is_active: false }).expect(200);
  });

  it('una retención creada a mano solo aplica en compras', async () => {
    // Quien retiene es quien paga: una retención en una venta no existe.
    const response = await owner
      .as('post', '/api/v1/taxes')
      .send({ code: 'RTF-TEST', name: 'ReteFuente prueba', kind: 'WITHHOLDING_INCOME', rate: '7', appliesTo: 'SALE' })
      .expect(201);
    expect(response.body.applies_to).toBe('PURCHASE');
    expect(response.body.is_withholding).toBe(true);
  });
});

describe('unidades de medida', () => {
  it('no permite cambiar el factor de una unidad en uso', async () => {
    const caja = await owner
      .as('post', '/api/v1/uoms')
      .send({ code: 'CJ6', name: 'Caja x 6', dimension: 'UNIT', factor: '6', precision: 0 })
      .expect(201);

    await owner.as('post', '/api/v1/products').send({ name: 'En cajas', uomId: caja.body.id }).expect(201);

    // 100 cajas de 6 pasarían a ser 100 cajas de 12 sin que se mueva nada.
    const response = await owner.as('patch', `/api/v1/uoms/${caja.body.id}`).send({ factor: '12' }).expect(422);
    expect(response.body.error.message).toMatch(/Crea una unidad nueva/);

    // El nombre sí se puede corregir.
    await owner.as('patch', `/api/v1/uoms/${caja.body.id}`).send({ name: 'Caja por seis' }).expect(200);
  });

  it('no permite borrar la unidad base de una dimensión', async () => {
    const und = await uomId('UND');
    const response = await owner.as('delete', `/api/v1/uoms/${und}`).expect(422);
    expect(response.body.error.message).toMatch(/unidad base/);
  });
});

describe('listas de precios', () => {
  let producto: string;
  let general: string;

  beforeAll(async () => {
    const created = await owner
      .as('post', '/api/v1/products')
      .send({ name: 'Producto con precios', sku: 'PRE-001', salePrice: '15000' })
      .expect(201);
    producto = created.body.id;
    const lists = await owner.as('get', '/api/v1/price-lists').expect(200);
    general = lists.body.items.find((l: { name: string }) => l.name === 'General').id;
  });

  it('sin precio en lista usa el del producto', async () => {
    const { body } = await owner.as('get', `/api/v1/products/${producto}/price`).expect(200);
    expect(body.price).toBe('15000.0000');
    expect(body.sourceListId).toBe(general);
  });

  it('aplica el precio de la lista y sus escalas por cantidad', async () => {
    await owner
      .as('post', `/api/v1/price-lists/${general}/items`)
      .send({ productId: producto, price: '12000' })
      .expect(201);
    await owner
      .as('post', `/api/v1/price-lists/${general}/items`)
      .send({ productId: producto, minQuantity: '50', price: '9500' })
      .expect(201);

    const uno = await owner.as('get', `/api/v1/products/${producto}/price?quantity=1`).expect(200);
    expect(uno.body.price).toBe('12000.0000');

    const muchos = await owner.as('get', `/api/v1/products/${producto}/price?quantity=60`).expect(200);
    expect(muchos.body.price).toBe('9500.0000');
    expect(muchos.body.appliedTier).toBe('50');
  });

  it('fijar dos veces el mismo escalón corrige el precio en lugar de fallar', async () => {
    await owner
      .as('post', `/api/v1/price-lists/${general}/items`)
      .send({ productId: producto, price: '11000' })
      .expect(201);
    const uno = await owner.as('get', `/api/v1/products/${producto}/price?quantity=1`).expect(200);
    expect(uno.body.price).toBe('11000.0000');
  });

  it('una lista derivada calcula su precio desde la base', async () => {
    const distribuidores = await owner
      .as('post', '/api/v1/price-lists')
      .send({ name: 'Distribuidores', mode: 'DERIVED', basedOnId: general, adjustmentPercent: '15' })
      .expect(201);

    const { body } = await owner
      .as('get', `/api/v1/products/${producto}/price?priceListId=${distribuidores.body.id}`)
      .expect(200);
    // 11.000 de la lista general, menos el 15 %.
    expect(body.price).toBe('9350.0000');
    expect(body.sourceLabel).toBe('General');
  });

  it('impide encadenar dos listas entre sí', async () => {
    const a = await owner.as('post', '/api/v1/price-lists').send({ name: 'Cadena A' }).expect(201);
    const b = await owner
      .as('post', '/api/v1/price-lists')
      .send({ name: 'Cadena B', mode: 'DERIVED', basedOnId: a.body.id })
      .expect(201);

    const response = await owner
      .as('patch', `/api/v1/price-lists/${a.body.id}`)
      .send({ mode: 'DERIVED', basedOnId: b.body.id })
      .expect(422);
    expect(response.body.error.message).toMatch(/ciclo/);
  });

  it('una lista fuera de vigencia no se aplica', async () => {
    const promo = await owner
      .as('post', '/api/v1/price-lists')
      .send({ name: 'Promo enero', validFrom: '2026-01-01', validTo: '2026-01-31' })
      .expect(201);
    await owner
      .as('post', `/api/v1/price-lists/${promo.body.id}/items`)
      .send({ productId: producto, price: '7000' })
      .expect(201);

    // El reloj de los tests está en marzo de 2026.
    const hoy = await owner
      .as('get', `/api/v1/products/${producto}/price?priceListId=${promo.body.id}`)
      .expect(200);
    expect(hoy.body.price).toBe('15000.0000');

    // Refacturar enero tiene que dar el precio de enero.
    const enero = await owner
      .as('get', `/api/v1/products/${producto}/price?priceListId=${promo.body.id}&on=2026-01-15`)
      .expect(200);
    expect(enero.body.price).toBe('7000.0000');
  });

  it('el listado de precios de una lista solo muestra los suyos', async () => {
    const items = await owner.as('get', `/api/v1/price-lists/${general}/items`).expect(200);
    expect(items.body.items.length).toBeGreaterThan(0);
    for (const item of items.body.items) expect(item.sku).toBe('PRE-001');
  });

  it('no borra una lista de la que otras derivan', async () => {
    const response = await owner.as('delete', `/api/v1/price-lists/${general}`).expect(422);
    expect(response.body.error.message).toMatch(/quedarían sin base/);
  });
});

describe('alcance de permisos', () => {
  it('el comercial ve el catálogo pero no lo modifica', async () => {
    // La plantilla "Comercial" concede `catalog:*:read` y nada más: quien vende
    // no decide qué productos existen ni a qué precio de lista.
    const seller = await inviteMember(t, owner, { roleCodes: ['SALES'] });
    await seller.as('get', '/api/v1/products').expect(200);
    await seller.as('post', '/api/v1/products').send({ name: 'No debería poder' }).expect(403);
    await seller.as('post', '/api/v1/price-lists').send({ name: 'Tampoco' }).expect(403);
  });

  it('con alcance OWN solo se ven los productos propios', async () => {
    // Rol a medida, como el que configuraría una empresa cuyos jefes de línea
    // mantienen cada uno su parte del catálogo.
    const role = await owner
      .as('post', '/api/v1/roles')
      .send({
        name: 'Jefe de línea',
        permissions: [
          { key: 'catalog:product:read', scope: 'OWN' },
          { key: 'catalog:product:create', scope: 'OWN' },
          { key: 'catalog:product:update', scope: 'OWN' },
        ],
      })
      .expect(201);

    const seller = await inviteMember(t, owner, {});
    await owner
      .as('put', `/api/v1/members/${seller.membershipId}/roles`)
      .send({ roleIds: [role.body.id] })
      .expect(204);

    // Sin volver a iniciar sesión: los permisos se resuelven contra la base en
    // cada petición, así que quitarle un rol a alguien surte efecto de inmediato
    // y no cuando caduque su token.
    const suyo = await seller
      .as('post', '/api/v1/products')
      .send({ name: 'Producto del jefe de línea', sku: 'VEN-001' })
      .expect(201);

    const visible = await seller.as('get', '/api/v1/products').expect(200);
    const ids = visible.body.items.map((p: { id: string }) => p.id);
    expect(ids).toContain(suyo.body.id);
    expect(visible.body.total).toBe(1);

    // Y el resumen usa el MISMO filtro: si no, mostraría cifras de productos que
    // ni siquiera puede abrir.
    const overview = await seller.as('get', '/api/v1/products/overview').expect(200);
    expect(overview.body.total).toBe(1);

    const todos = await owner.as('get', '/api/v1/products').expect(200);
    expect(todos.body.total).toBeGreaterThan(1);
  });
});

describe('borrado', () => {
  it('es lógico y libera el SKU', async () => {
    const primero = await owner
      .as('post', '/api/v1/products')
      .send({ name: 'A borrar', sku: 'DEL-001' })
      .expect(201);
    await owner.as('delete', `/api/v1/products/${primero.body.id}`).expect(204);
    await owner.as('get', `/api/v1/products/${primero.body.id}`).expect(404);

    // La fila sigue: una factura del año pasado no puede quedar apuntando a nada.
    const rows = await asTenant(t, owner, async (client) => {
      const result = await client.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM products WHERE id = $1',
        [primero.body.id],
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deleted_at).toBeInstanceOf(Date);

    // El índice único es parcial sobre `deleted_at IS NULL`: el código vuelve a estar libre.
    await owner.as('post', '/api/v1/products').send({ name: 'Reutiliza', sku: 'DEL-001' }).expect(201);
  });
});

/** Identificador de una unidad por su código, para los tests que lo necesitan. */
const uomId = async (code: string): Promise<string> => {
  const { body } = await owner.as('get', '/api/v1/uoms').expect(200);
  const uom = body.items.find((u: { code: string }) => u.code === code);
  if (!uom) throw new Error(`no existe la unidad ${code}`);
  return uom.id;
};
