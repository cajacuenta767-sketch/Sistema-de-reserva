import { AppError, newId, type Clock } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import { assertCan } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import { categoryPath, assertNotOwnDescendant } from '../../domain/Product.js';
import type { Uom, UomDimension } from '../../domain/Uom.js';
import { resolvePrice, type ResolvedPrice } from '../../domain/Pricing.js';
import type {
  CategoryNode,
  CategoryRepository,
  PriceItemRecord,
  PriceItemRow,
  PriceListRecord,
  PriceListRepository,
  ProductRepository,
  TaxRepository,
  TaxRow,
  UomRepository,
} from '../ports/CatalogRepositories.js';

// ── Unidades de medida ───────────────────────────────────────────────────────

export class UomUseCases {
  constructor(
    private readonly uoms: UomRepository,
    private readonly audit: AuditRecorder,
  ) {}

  async list(ctx: RequestContext, tx: Tx): Promise<Uom[]> {
    assertCan(ctx, 'catalog:uom:read');
    return this.uoms.list(tx, ctx.organizationId);
  }

  async create(
    ctx: RequestContext,
    tx: Tx,
    input: {
      code: string;
      name: string;
      dimension: UomDimension;
      factor?: string;
      precision?: number;
      dianCode?: string | null;
    },
  ): Promise<Uom> {
    assertCan(ctx, 'catalog:uom:manage');
    const code = input.code.trim().toUpperCase();
    const existing = await this.uoms.findByCode(tx, ctx.organizationId, code);
    if (existing) throw AppError.conflict(`Ya existe la unidad ${code}`);

    const uom: Uom = {
      id: newId(),
      organizationId: ctx.organizationId,
      code,
      name: input.name.trim(),
      dimension: input.dimension,
      factor: input.factor ?? '1',
      precision: input.precision ?? 2,
      dianCode: input.dianCode?.trim() || null,
      // La base de cada dimensión la fija la siembra. Una unidad creada a mano
      // nunca es base: cambiarla obligaría a reescribir todas las existencias.
      isBase: false,
      isActive: true,
    };
    await this.uoms.save(tx, uom);
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'uom',
      entityId: uom.id,
      entityLabel: `${uom.code} · ${uom.name}`,
      after: { ...uom },
    });
    return uom;
  }

  async update(ctx: RequestContext, tx: Tx, id: string, input: Partial<Uom>): Promise<Uom> {
    assertCan(ctx, 'catalog:uom:manage');
    const before = await this.uoms.findById(tx, id);
    if (!before) throw AppError.notFound('Unidad de medida');

    // Cambiar el factor de una unidad en uso reinterpreta todas las existencias
    // registradas con ella: 100 cajas de 12 pasarían a ser 100 cajas de 24 sin
    // que se haya movido nada. Hay que crear otra unidad.
    if (input.factor !== undefined && input.factor !== before.factor) {
      if (await this.uoms.isInUse(tx, id)) {
        throw AppError.rule(
          `No se puede cambiar el factor de ${before.code}: hay productos que la usan y sus ` +
            `cantidades quedarían mal. Crea una unidad nueva con el factor correcto.`,
        );
      }
    }

    const uom: Uom = {
      ...before,
      name: input.name?.trim() || before.name,
      factor: input.factor ?? before.factor,
      precision: input.precision ?? before.precision,
      dianCode: input.dianCode === undefined ? before.dianCode : input.dianCode,
      isActive: input.isActive ?? before.isActive,
    };
    await this.uoms.update(tx, uom);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'uom',
      entityId: id,
      entityLabel: `${uom.code} · ${uom.name}`,
      before: { ...before },
      after: { ...uom },
    });
    return uom;
  }

  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'catalog:uom:manage');
    const before = await this.uoms.findById(tx, id);
    if (!before) throw AppError.notFound('Unidad de medida');
    if (before.isBase) {
      throw AppError.rule(
        `${before.code} es la unidad base de ${before.dimension}: sin ella, ninguna conversión de ` +
          `esa dimensión tendría referencia`,
      );
    }
    if (await this.uoms.isInUse(tx, id)) {
      throw AppError.rule(`No se puede borrar ${before.code}: hay productos que la usan`);
    }
    await this.uoms.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'uom',
      entityId: id,
      entityLabel: `${before.code} · ${before.name}`,
      before: { ...before },
    });
  }
}

// ── Categorías ───────────────────────────────────────────────────────────────

export class CategoryUseCases {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly audit: AuditRecorder,
  ) {}

  async tree(ctx: RequestContext, tx: Tx): Promise<CategoryNode[]> {
    assertCan(ctx, 'catalog:product:read');
    return this.categories.tree(tx, ctx.organizationId);
  }

  async create(
    ctx: RequestContext,
    tx: Tx,
    input: { name: string; parentId?: string | null; description?: string | null },
  ): Promise<CategoryNode> {
    assertCan(ctx, 'catalog:category:manage');
    const name = input.name.trim();
    if (!name) throw AppError.validation('La categoría necesita un nombre');
    if (name.includes('/')) {
      // La barra es el separador de la ruta materializada: permitirla en el
      // nombre rompería el filtrado por rama.
      throw AppError.validation('El nombre de una categoría no puede contener "/"');
    }

    const parent = input.parentId ? await this.categories.findById(tx, input.parentId) : null;
    if (input.parentId && !parent) throw AppError.validation('La categoría padre no existe');

    const path = categoryPath(parent?.path ?? null, name);
    const clash = await this.categories.findByPath(tx, ctx.organizationId, path);
    if (clash) throw AppError.conflict(`Ya existe la categoría "${path}"`);

    const node = {
      id: newId(),
      parentId: parent?.id ?? null,
      name,
      path,
      depth: (parent?.depth ?? -1) + 1,
      description: input.description?.trim() || null,
      isActive: true,
    };
    await this.categories.save(tx, ctx.organizationId, node);
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'product_category',
      entityId: node.id,
      entityLabel: path,
      after: { ...node },
    });
    return { ...node, productCount: 0 };
  }

  async update(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: { name?: string; parentId?: string | null; description?: string | null; isActive?: boolean },
  ): Promise<CategoryNode> {
    assertCan(ctx, 'catalog:category:manage');
    const before = await this.categories.findById(tx, id);
    if (!before) throw AppError.notFound('Categoría');

    const name = input.name?.trim() || before.name;
    if (name.includes('/')) throw AppError.validation('El nombre de una categoría no puede contener "/"');

    const parentId = input.parentId === undefined ? before.parentId : input.parentId;
    const parent = parentId ? await this.categories.findById(tx, parentId) : null;
    if (parentId && !parent) throw AppError.validation('La categoría padre no existe');
    assertNotOwnDescendant(before.path, parent?.path ?? null);

    const path = categoryPath(parent?.path ?? null, name);
    if (path !== before.path) {
      const clash = await this.categories.findByPath(tx, ctx.organizationId, path);
      if (clash) throw AppError.conflict(`Ya existe la categoría "${path}"`);
      // La rama entera se reescribe ANTES que el nodo: hacerlo al revés dejaría
      // a los hijos apuntando a una ruta que ya no existe si algo fallara.
      await this.categories.rewriteSubtree(tx, ctx.organizationId, before.path, path);
    }

    const node = {
      id,
      parentId: parent?.id ?? null,
      name,
      path,
      depth: (parent?.depth ?? -1) + 1,
      description: input.description === undefined ? before.description : input.description?.trim() || null,
      isActive: input.isActive ?? before.isActive,
    };
    await this.categories.update(tx, ctx.organizationId, node);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'product_category',
      entityId: id,
      entityLabel: path,
      before: { ...before },
      after: { ...node },
    });
    return { ...node, productCount: before.productCount };
  }

  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'catalog:category:manage');
    const before = await this.categories.findById(tx, id);
    if (!before) throw AppError.notFound('Categoría');

    if (await this.categories.hasChildren(tx, id)) {
      throw AppError.rule(`"${before.path}" tiene subcategorías: muévelas o bórralas primero`);
    }
    if (await this.categories.hasProducts(tx, id)) {
      throw AppError.rule(
        `"${before.path}" tiene productos: reasígnalos a otra categoría antes de borrarla`,
      );
    }
    await this.categories.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'product_category',
      entityId: id,
      entityLabel: before.path,
      before: { ...before },
    });
  }
}

// ── Impuestos ────────────────────────────────────────────────────────────────

export class TaxUseCases {
  constructor(
    private readonly taxes: TaxRepository,
    private readonly audit: AuditRecorder,
  ) {}

  async list(ctx: RequestContext, tx: Tx): Promise<TaxRow[]> {
    assertCan(ctx, 'catalog:tax:read');
    return this.taxes.list(tx, ctx.organizationId);
  }

  async create(
    ctx: RequestContext,
    tx: Tx,
    input: {
      code: string;
      name: string;
      kind: TaxRow['kind'];
      rate: string;
      appliesTo?: string;
      minBase?: string | null;
      dianTaxCode?: string | null;
    },
  ): Promise<TaxRow> {
    assertCan(ctx, 'catalog:tax:manage');
    const code = input.code.trim().toUpperCase();
    const existing = await this.taxes.findByCode(tx, ctx.organizationId, code);
    if (existing) throw AppError.conflict(`Ya existe el impuesto ${code}`);

    const isWithholding = String(input.kind).startsWith('WITHHOLDING_');
    const tax: TaxRow = {
      id: newId(),
      code,
      name: input.name.trim(),
      kind: input.kind,
      rate: input.rate,
      is_withholding: isWithholding,
      // Una retención solo existe en las compras: el que retiene es quien paga.
      applies_to: isWithholding ? 'PURCHASE' : (input.appliesTo ?? 'BOTH'),
      min_base: input.minBase ?? null,
      dian_tax_code: input.dianTaxCode ?? null,
      is_active: true,
    };
    await this.taxes.save(tx, ctx.organizationId, tax);
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'tax',
      entityId: tax.id,
      entityLabel: `${tax.code} · ${tax.name}`,
      after: { ...tax },
    });
    return tax;
  }

  async update(ctx: RequestContext, tx: Tx, id: string, input: Partial<TaxRow>): Promise<TaxRow> {
    assertCan(ctx, 'catalog:tax:manage');
    const before = await this.taxes.findById(tx, id);
    if (!before) throw AppError.notFound('Impuesto');

    // Cambiar la tarifa de un impuesto en uso NO se bloquea —las reformas
    // tributarias existen— pero cambia el cálculo de los documentos futuros, no
    // el de los ya emitidos: éstos guardan su propia tarifa en la línea.
    const tax: TaxRow = {
      ...before,
      code: input.code?.trim().toUpperCase() || before.code,
      name: input.name?.trim() || before.name,
      rate: input.rate ?? before.rate,
      applies_to: input.applies_to ?? before.applies_to,
      min_base: input.min_base === undefined ? before.min_base : input.min_base,
      dian_tax_code: input.dian_tax_code === undefined ? before.dian_tax_code : input.dian_tax_code,
      is_active: input.is_active ?? before.is_active,
    };
    await this.taxes.update(tx, ctx.organizationId, tax);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'tax',
      entityId: id,
      entityLabel: `${tax.code} · ${tax.name}`,
      before: { ...before },
      after: { ...tax },
    });
    return tax;
  }

  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'catalog:tax:manage');
    const before = await this.taxes.findById(tx, id);
    if (!before) throw AppError.notFound('Impuesto');
    if (await this.taxes.isInUse(tx, id)) {
      throw AppError.rule(
        `No se puede borrar ${before.code}: hay productos que lo usan. Desactívalo en su lugar.`,
      );
    }
    await this.taxes.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'tax',
      entityId: id,
      entityLabel: `${before.code} · ${before.name}`,
      before: { ...before },
    });
  }
}

// ── Listas de precios ────────────────────────────────────────────────────────

export interface PriceQuery {
  productId: string;
  variantId?: string | null;
  quantity?: string;
  priceListId?: string | null;
  /** Fecha del documento. Sin ella se usa hoy. */
  on?: string;
}

export class PriceListUseCases {
  constructor(
    private readonly lists: PriceListRepository,
    private readonly products: ProductRepository,
    private readonly audit: AuditRecorder,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, kind?: 'SALE' | 'PURCHASE'): Promise<PriceListRecord[]> {
    assertCan(ctx, 'catalog:pricelist:read');
    return this.lists.list(tx, ctx.organizationId, kind);
  }

  async create(
    ctx: RequestContext,
    tx: Tx,
    input: {
      name: string;
      kind?: 'SALE' | 'PURCHASE';
      currencyCode?: string;
      mode?: 'FIXED' | 'DERIVED';
      basedOnId?: string | null;
      adjustmentPercent?: string;
      rounding?: string;
      includesTax?: boolean;
      validFrom?: string | null;
      validTo?: string | null;
      isDefault?: boolean;
    },
  ): Promise<PriceListRecord> {
    assertCan(ctx, 'catalog:pricelist:manage');
    const mode = input.mode ?? 'FIXED';
    const kind = input.kind ?? 'SALE';

    if (mode === 'DERIVED') {
      if (!input.basedOnId) throw AppError.validation('Una lista derivada necesita una lista base');
      const base = await this.lists.findById(tx, input.basedOnId);
      if (!base) throw AppError.validation('La lista base indicada no existe');
      if (base.kind !== kind) {
        throw AppError.rule('Una lista de venta no puede derivar de una de compra, ni al revés');
      }
    }

    const record: PriceListRecord = {
      id: newId(),
      organizationId: ctx.organizationId,
      name: input.name.trim(),
      kind,
      currencyCode: input.currencyCode ?? 'COP',
      mode,
      basedOnId: mode === 'DERIVED' ? (input.basedOnId ?? null) : null,
      adjustmentPercent: input.adjustmentPercent ?? '0',
      rounding: input.rounding ?? '0',
      includesTax: input.includesTax ?? false,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      isDefault: input.isDefault ?? false,
      isActive: true,
    };

    // El índice único garantiza una sola lista por defecto; limpiar antes evita
    // que marcar una nueva falle con un error de base de datos.
    if (record.isDefault) await this.lists.clearDefault(tx, ctx.organizationId, kind);

    await this.lists.save(tx, record);
    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'price_list',
      entityId: record.id,
      entityLabel: record.name,
      after: { ...record },
    });
    return record;
  }

  async update(
    ctx: RequestContext,
    tx: Tx,
    id: string,
    input: Partial<PriceListRecord>,
  ): Promise<PriceListRecord> {
    assertCan(ctx, 'catalog:pricelist:manage');
    const before = await this.lists.findById(tx, id);
    if (!before) throw AppError.notFound('Lista de precios');

    const basedOnId = input.basedOnId === undefined ? before.basedOnId : input.basedOnId;
    if (basedOnId === id) throw AppError.rule('Una lista no puede derivar de sí misma');
    if (basedOnId) {
      // Sin esto se podrían encadenar dos listas entre sí. La consulta de cadena
      // lo soporta (corta el ciclo), pero el precio resultante dependería del
      // orden de recorrido, que es una forma retorcida de "depende".
      const chain = await this.lists.chain(tx, basedOnId);
      if (chain.some((l) => l.id === id)) {
        throw AppError.rule('Esa lista ya deriva de ésta: se formaría un ciclo');
      }
    }

    const record: PriceListRecord = {
      ...before,
      name: input.name?.trim() || before.name,
      currencyCode: input.currencyCode ?? before.currencyCode,
      mode: input.mode ?? before.mode,
      basedOnId,
      adjustmentPercent: input.adjustmentPercent ?? before.adjustmentPercent,
      rounding: input.rounding ?? before.rounding,
      includesTax: input.includesTax ?? before.includesTax,
      validFrom: input.validFrom === undefined ? before.validFrom : input.validFrom,
      validTo: input.validTo === undefined ? before.validTo : input.validTo,
      isDefault: input.isDefault ?? before.isDefault,
      isActive: input.isActive ?? before.isActive,
    };
    if (record.mode === 'DERIVED' && !record.basedOnId) {
      throw AppError.validation('Una lista derivada necesita una lista base');
    }
    if (record.isDefault && !before.isDefault) {
      await this.lists.clearDefault(tx, ctx.organizationId, record.kind);
    }

    await this.lists.update(tx, record);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'price_list',
      entityId: id,
      entityLabel: record.name,
      before: { ...before },
      after: { ...record },
    });
    return record;
  }

  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'catalog:pricelist:manage');
    const before = await this.lists.findById(tx, id);
    if (!before) throw AppError.notFound('Lista de precios');
    if (await this.lists.hasDerived(tx, id)) {
      throw AppError.rule(`Hay listas que derivan de "${before.name}": quedarían sin base de cálculo`);
    }
    await this.lists.delete(tx, id);
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'price_list',
      entityId: id,
      entityLabel: before.name,
      before: { ...before },
    });
  }

  async items(ctx: RequestContext, tx: Tx, priceListId: string, query: ListQuery): Promise<ListResult<PriceItemRow>> {
    assertCan(ctx, 'catalog:pricelist:read');
    const list = await this.lists.findById(tx, priceListId);
    if (!list) throw AppError.notFound('Lista de precios');
    return this.lists.listItems(tx, query, priceListId);
  }

  async setItem(
    ctx: RequestContext,
    tx: Tx,
    priceListId: string,
    input: { productId: string; variantId?: string | null; minQuantity?: string; price: string },
  ): Promise<PriceItemRecord> {
    assertCan(ctx, 'catalog:pricelist:manage');
    const list = await this.lists.findById(tx, priceListId);
    if (!list) throw AppError.notFound('Lista de precios');
    const product = await this.products.findById(tx, input.productId);
    if (!product) throw AppError.validation('El producto indicado no existe');

    const item: PriceItemRecord = {
      id: newId(),
      organizationId: ctx.organizationId,
      priceListId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      minQuantity: input.minQuantity ?? '1',
      price: input.price,
    };
    item.id = await this.lists.saveItem(tx, item);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'price_list',
      entityId: priceListId,
      entityLabel: list.name,
      after: { producto: product.sku, cantidadMinima: item.minQuantity, precio: item.price },
    });
    return item;
  }

  async removeItem(ctx: RequestContext, tx: Tx, itemId: string): Promise<void> {
    assertCan(ctx, 'catalog:pricelist:manage');
    const item = await this.lists.findItem(tx, itemId);
    if (!item) throw AppError.notFound('Precio');
    await this.lists.deleteItem(tx, itemId);
  }

  /**
   * Precio aplicable a un producto. Lo llamará cada línea de cada documento.
   *
   * Es el punto único donde se responde "¿a cuánto se lo vendo?". Que la
   * cotización, el pedido y la factura pregunten aquí es lo que garantiza que
   * los tres digan lo mismo.
   */
  async priceFor(ctx: RequestContext, tx: Tx, query: PriceQuery): Promise<ResolvedPrice> {
    assertCan(ctx, 'catalog:product:read');
    const product = await this.products.findById(tx, query.productId);
    if (!product) throw AppError.notFound('Producto');

    const listId =
      query.priceListId ?? (await this.lists.findDefault(tx, ctx.organizationId, 'SALE'))?.id ?? null;
    const chain = listId ? await this.lists.chain(tx, listId) : [];
    const tiers =
      chain.length > 0
        ? await this.lists.tiersFor(tx, chain.map((l) => l.id), query.productId, query.variantId ?? null)
        : [];

    return resolvePrice({
      basePrice: product.salePrice,
      quantity: query.quantity ?? '1',
      on: query.on ?? this.clock.now().toISOString().slice(0, 10),
      chain,
      tiers,
    });
  }
}
