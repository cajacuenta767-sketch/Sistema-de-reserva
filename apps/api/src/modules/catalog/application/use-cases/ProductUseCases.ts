import { AppError, newId, type Clock } from '@erp/core';
import type { ListQuery } from '@erp/contracts';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import type { AuditRecorder } from '../../../../platform/audit/AuditRecorder.js';
import type { EventBus } from '../../../../platform/events/EventBus.js';
import { assertCan, assertWithinScope, scopeFilter } from '../../../../platform/authz/scope.js';
import type { ListResult } from '../../../../platform/http/list.js';
import {
  assertConsistent,
  normalizeSku,
  skuFromName,
  variantName,
  type Product,
  type ProductVariant,
} from '../../domain/Product.js';
import { marginPercent } from '../../domain/Pricing.js';
import { DEFAULT_SALE_TAX_CODE } from '../../domain/ColombianTaxes.js';
import type {
  CategoryRepository,
  ProductForDocument,
  ProductOverview,
  ProductRepository,
  ProductSearchHit,
  ProductRow,
  TaxRepository,
  TaxRow,
  UomRepository,
  VariantRepository,
} from '../ports/CatalogRepositories.js';

export interface CreateProductInput {
  sku?: string | null;
  barcode?: string | null;
  name: string;
  description?: string | null;
  kind?: Product['kind'];
  categoryId?: string | null;
  uomId?: string | null;
  uomCode?: string | null;
  saleUomId?: string | null;
  purchaseUomId?: string | null;
  salePrice?: string;
  purchasePrice?: string;
  currencyCode?: string;
  priceIncludesTax?: boolean;
  saleTaxId?: string | null;
  purchaseTaxId?: string | null;
  trackInventory?: boolean;
  costMethod?: Product['costMethod'];
  standardCost?: string;
  minStock?: string | null;
  maxStock?: string | null;
  tracking?: Product['tracking'];
  brand?: string | null;
  manufacturerSku?: string | null;
  weightKg?: string | null;
  isSellable?: boolean;
  isPurchasable?: boolean;
  isActive?: boolean;
  ownerMembershipId?: string | null;
  variants?: Array<{ sku?: string | null; attributes: Record<string, string>; priceDelta?: string }>;
}

export type UpdateProductInput = Partial<CreateProductInput>;

/** Impuesto tal como lo necesita la ficha para mostrarse. */
export interface TaxRef {
  id: string;
  code: string;
  name: string;
  kind: string;
  rate: string;
}

/** Ficha completa del producto, tal como la pinta la pantalla de detalle. */
export interface ProductDetail {
  product: Product;
  variants: ProductVariant[];
  uom: { id: string; code: string; name: string; precision: number } | null;
  categoryPath: string | null;
  // `kind` va incluido porque decide cómo se escribe la tarifa: el ReteICA se
  // publica por mil (9,66 × 1000) y el resto en porcentaje. Sin él, la pantalla
  // tendría que adivinarlo por el código del impuesto.
  saleTax: TaxRef | null;
  purchaseTax: TaxRef | null;
  /** Margen sobre el precio de compra. `null` si no hay precio de venta. */
  marginPercent: string | null;
}

export class ProductUseCases {
  constructor(
    private readonly products: ProductRepository,
    private readonly variants: VariantRepository,
    private readonly uoms: UomRepository,
    private readonly categories: CategoryRepository,
    private readonly taxes: TaxRepository,
    private readonly audit: AuditRecorder,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async list(ctx: RequestContext, tx: Tx, query: ListQuery): Promise<ListResult<ProductRow>> {
    assertCan(ctx, 'catalog:product:read');
    return this.products.list(tx, query, scopeFilter(ctx, 'catalog:product:read'));
  }

  async get(ctx: RequestContext, tx: Tx, id: string): Promise<ProductDetail> {
    assertCan(ctx, 'catalog:product:read');
    const product = await this.products.findById(tx, id);
    if (!product) throw AppError.notFound('Producto');
    assertWithinScope(ctx, 'catalog:product:read', { ownerMembershipId: product.ownerMembershipId });

    // Secuencial: las consultas comparten el cliente de la transacción, que
    // ejecuta una a la vez. Lanzarlas con Promise.all no las paralelizaría.
    const variants = await this.variants.listByProduct(tx, id);
    const uom = await this.uoms.findById(tx, product.uomId);
    const category = product.categoryId ? await this.categories.findById(tx, product.categoryId) : null;
    const saleTax = product.saleTaxId ? await this.taxes.findById(tx, product.saleTaxId) : null;
    const purchaseTax = product.purchaseTaxId ? await this.taxes.findById(tx, product.purchaseTaxId) : null;

    return {
      product,
      variants,
      uom: uom ? { id: uom.id, code: uom.code, name: uom.name, precision: uom.precision } : null,
      categoryPath: category?.path ?? null,
      saleTax: taxRef(saleTax),
      purchaseTax: taxRef(purchaseTax),
      marginPercent: marginPercent(product.salePrice, product.purchasePrice),
    };
  }

  async overview(ctx: RequestContext, tx: Tx): Promise<ProductOverview> {
    assertCan(ctx, 'catalog:product:read');
    return this.products.overview(tx, ctx.organizationId, scopeFilter(ctx, 'catalog:product:read'));
  }

  async create(ctx: RequestContext, tx: Tx, input: CreateProductInput): Promise<Product> {
    assertCan(ctx, 'catalog:product:create');

    const name = input.name.trim();
    if (!name) throw AppError.validation('El producto necesita un nombre');

    const kind = input.kind ?? 'GOOD';
    // Un servicio nunca lleva existencias, aunque no lo digan: obligar a marcarlo
    // convertiría la regla en un paso que se olvida.
    const trackInventory = input.trackInventory ?? kind !== 'SERVICE';

    const uomId = await this.resolveUom(tx, ctx.organizationId, input, kind);
    const sku = await this.resolveSku(tx, ctx.organizationId, input.sku, name);
    await this.assertBarcodeFree(tx, ctx.organizationId, input.barcode ?? null, null);

    const draft = {
      kind,
      trackInventory,
      tracking: input.tracking ?? 'NONE',
      isSellable: input.isSellable ?? true,
      isPurchasable: input.isPurchasable ?? true,
    };
    assertConsistent(draft);

    const now = this.clock.now();
    const product: Product = {
      id: newId(),
      organizationId: ctx.organizationId,
      sku,
      barcode: input.barcode?.trim() || null,
      name,
      description: input.description?.trim() || null,
      kind,
      categoryId: await this.validCategory(tx, input.categoryId ?? null),
      uomId,
      saleUomId: await this.compatibleUom(tx, uomId, input.saleUomId ?? null, 'de venta'),
      purchaseUomId: await this.compatibleUom(tx, uomId, input.purchaseUomId ?? null, 'de compra'),
      salePrice: input.salePrice ?? '0',
      purchasePrice: input.purchasePrice ?? '0',
      currencyCode: input.currencyCode ?? 'COP',
      priceIncludesTax: input.priceIncludesTax ?? false,
      // Sin impuesto explícito se aplica el IVA general: en Colombia es la
      // situación por defecto, y dejarlo vacío produciría facturas sin IVA.
      saleTaxId: input.saleTaxId ?? (await this.defaultSaleTaxId(tx, ctx.organizationId)),
      /*
       * El impuesto de compra también viene por defecto, y es el mismo.
       *
       * Un bien gravado al 19 % lo está en los dos sentidos: la empresa lo
       * cobra al vender y lo paga al comprar. Dejarlo vacío registraba cada
       * compra sin IVA descontable, lo que sobrevalora el costo y regala el
       * crédito fiscal —un error que no da ningún aviso y solo aparece al
       * declarar—. Un producto excluido se configura como tal, que es la
       * excepción y por eso se declara.
       */
      purchaseTaxId:
        input.purchaseTaxId ?? (await this.defaultSaleTaxId(tx, ctx.organizationId)),
      trackInventory,
      costMethod: input.costMethod ?? 'AVERAGE',
      standardCost: input.standardCost ?? '0',
      minStock: input.minStock ?? null,
      maxStock: input.maxStock ?? null,
      tracking: draft.tracking,
      incomeAccountId: null,
      expenseAccountId: null,
      inventoryAccountId: null,
      brand: input.brand?.trim() || null,
      manufacturerSku: input.manufacturerSku?.trim() || null,
      weightKg: input.weightKg ?? null,
      isSellable: draft.isSellable,
      isPurchasable: draft.isPurchasable,
      isActive: input.isActive ?? true,
      ownerMembershipId: input.ownerMembershipId ?? ctx.membershipId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    await this.products.save(tx, product);

    for (const variant of input.variants ?? []) {
      await this.addVariant(ctx, tx, product.id, variant, product);
    }

    await this.audit.record(tx, ctx, {
      action: 'CREATE',
      entityType: 'product',
      entityId: product.id,
      entityLabel: `${product.sku} · ${product.name}`,
      after: { ...product },
    });
    await this.events.publish(tx, {
      type: 'product.created',
      aggregateType: 'product',
      aggregateId: product.id,
      organizationId: ctx.organizationId,
      payload: { sku: product.sku, name: product.name, kind: product.kind },
      actorMembershipId: ctx.membershipId,
    });

    return product;
  }

  async update(ctx: RequestContext, tx: Tx, id: string, input: UpdateProductInput): Promise<Product> {
    assertCan(ctx, 'catalog:product:update');
    const before = await this.products.findById(tx, id);
    if (!before) throw AppError.notFound('Producto');
    assertWithinScope(ctx, 'catalog:product:update', { ownerMembershipId: before.ownerMembershipId });

    const sku = input.sku === undefined ? before.sku : normalizeSku(input.sku ?? before.sku);
    if (sku !== before.sku) {
      const clash = await this.products.findBySku(tx, ctx.organizationId, sku);
      if (clash) throw AppError.conflict(`El código ${sku} ya lo usa "${clash.name}"`, { productId: clash.id });
    }
    const barcode = input.barcode === undefined ? before.barcode : input.barcode?.trim() || null;
    await this.assertBarcodeFree(tx, ctx.organizationId, barcode, id);

    const kind = input.kind ?? before.kind;
    const trackInventory =
      input.trackInventory ?? (kind === 'SERVICE' ? false : before.trackInventory);
    const draft = {
      kind,
      trackInventory,
      tracking: input.tracking ?? (trackInventory ? before.tracking : 'NONE'),
      isSellable: input.isSellable ?? before.isSellable,
      isPurchasable: input.isPurchasable ?? before.isPurchasable,
    };
    assertConsistent(draft);

    const uomId =
      input.uomId || input.uomCode
        ? await this.resolveUom(tx, ctx.organizationId, input, kind)
        : before.uomId;

    const product: Product = {
      ...before,
      sku,
      barcode,
      name: input.name?.trim() || before.name,
      description: input.description === undefined ? before.description : input.description?.trim() || null,
      kind,
      categoryId:
        input.categoryId === undefined ? before.categoryId : await this.validCategory(tx, input.categoryId),
      uomId,
      saleUomId:
        input.saleUomId === undefined
          ? before.saleUomId
          : await this.compatibleUom(tx, uomId, input.saleUomId, 'de venta'),
      purchaseUomId:
        input.purchaseUomId === undefined
          ? before.purchaseUomId
          : await this.compatibleUom(tx, uomId, input.purchaseUomId, 'de compra'),
      salePrice: input.salePrice ?? before.salePrice,
      purchasePrice: input.purchasePrice ?? before.purchasePrice,
      currencyCode: input.currencyCode ?? before.currencyCode,
      priceIncludesTax: input.priceIncludesTax ?? before.priceIncludesTax,
      saleTaxId: input.saleTaxId === undefined ? before.saleTaxId : input.saleTaxId,
      purchaseTaxId: input.purchaseTaxId === undefined ? before.purchaseTaxId : input.purchaseTaxId,
      trackInventory,
      costMethod: input.costMethod ?? before.costMethod,
      standardCost: input.standardCost ?? before.standardCost,
      minStock: input.minStock === undefined ? before.minStock : input.minStock,
      maxStock: input.maxStock === undefined ? before.maxStock : input.maxStock,
      tracking: draft.tracking,
      brand: input.brand === undefined ? before.brand : input.brand?.trim() || null,
      manufacturerSku:
        input.manufacturerSku === undefined ? before.manufacturerSku : input.manufacturerSku?.trim() || null,
      weightKg: input.weightKg === undefined ? before.weightKg : input.weightKg,
      isSellable: draft.isSellable,
      isPurchasable: draft.isPurchasable,
      isActive: input.isActive ?? before.isActive,
      ownerMembershipId:
        input.ownerMembershipId === undefined ? before.ownerMembershipId : input.ownerMembershipId,
      updatedAt: this.clock.now(),
    };

    await this.products.update(tx, product);
    await this.audit.record(tx, ctx, {
      action: 'UPDATE',
      entityType: 'product',
      entityId: id,
      entityLabel: `${product.sku} · ${product.name}`,
      before: { ...before },
      after: { ...product },
    });

    if (before.salePrice !== product.salePrice) {
      // El cambio de precio es el dato que más se audita en un catálogo: quién
      // lo bajó y cuándo es la primera pregunta cuando cae el margen.
      await this.events.publish(tx, {
        type: 'product.price_changed',
        aggregateType: 'product',
        aggregateId: id,
        organizationId: ctx.organizationId,
        payload: { sku: product.sku, from: before.salePrice, to: product.salePrice },
        actorMembershipId: ctx.membershipId,
      });
    }

    return product;
  }

  async remove(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'catalog:product:delete');
    const before = await this.products.findById(tx, id);
    if (!before) throw AppError.notFound('Producto');
    assertWithinScope(ctx, 'catalog:product:delete', { ownerMembershipId: before.ownerMembershipId });

    // Borrado lógico: un producto referenciado por facturas de años anteriores no
    // puede desaparecer sin dejar líneas apuntando a la nada.
    await this.products.softDelete(tx, id, this.clock.now());
    await this.audit.record(tx, ctx, {
      action: 'DELETE',
      entityType: 'product',
      entityId: id,
      entityLabel: `${before.sku} · ${before.name}`,
      before: { ...before },
    });
  }

  // ── Variantes ─────────────────────────────────────────────────────────────

  async addVariant(
    ctx: RequestContext,
    tx: Tx,
    productId: string,
    input: { sku?: string | null; attributes: Record<string, string>; priceDelta?: string },
    known?: Product,
  ): Promise<ProductVariant> {
    assertCan(ctx, 'catalog:product:update');
    const product = known ?? (await this.products.findById(tx, productId));
    if (!product) throw AppError.notFound('Producto');

    const existing = await this.variants.listByProduct(tx, productId);
    const sku = input.sku ? normalizeSku(input.sku) : `${product.sku}-${existing.length + 1}`;
    const clash = await this.variants.findBySku(tx, ctx.organizationId, sku);
    if (clash) throw AppError.conflict(`El código de variante ${sku} ya está en uso`);

    const variant: ProductVariant = {
      id: newId(),
      organizationId: ctx.organizationId,
      productId,
      sku,
      barcode: null,
      name: variantName(product.name, input.attributes),
      attributes: input.attributes,
      priceDelta: input.priceDelta ?? '0',
      weightKg: null,
      isActive: true,
    };
    await this.variants.save(tx, variant);
    return variant;
  }

  async removeVariant(ctx: RequestContext, tx: Tx, id: string): Promise<void> {
    assertCan(ctx, 'catalog:product:update');
    const variant = await this.variants.findById(tx, id);
    if (!variant) throw AppError.notFound('Variante');
    await this.variants.softDelete(tx, id, this.clock.now());
  }

  async search(
    ctx: RequestContext,
    tx: Tx,
    term: string,
    limit: number,
  ): Promise<ProductSearchHit[]> {
    return this.products.search(tx, ctx.organizationId, term, limit);
  }

  /**
   * Datos de varios productos para las líneas de un documento.
   *
   * La usa el módulo de ventas al componer una factura: pide todos sus productos
   * de una vez en lugar de uno por línea. Sin permiso de lectura del catálogo no
   * se puede facturar, que es coherente: quien no ve los productos no puede
   * elegir cuáles vende.
   */
  async forDocument(ctx: RequestContext, tx: Tx, ids: readonly string[]): Promise<ProductForDocument[]> {
    assertCan(ctx, 'catalog:product:read');
    return this.products.forDocument(tx, ctx.organizationId, ids);
  }

  // ── Apoyo ─────────────────────────────────────────────────────────────────

  /** El SKU se acepta tal cual, o se genera; nunca se deja vacío. */
  private async resolveSku(
    tx: Tx,
    organizationId: string,
    raw: string | null | undefined,
    name: string,
  ): Promise<string> {
    if (raw && raw.trim()) {
      const sku = normalizeSku(raw);
      const clash = await this.products.findBySku(tx, organizationId, sku);
      if (clash) throw AppError.conflict(`El código ${sku} ya lo usa "${clash.name}"`, { productId: clash.id });
      return sku;
    }

    // Generado desde el nombre. Si choca (dos productos con nombre parecido),
    // se avanza el contador en vez de fallar: el usuario no pidió ese código.
    let sequence = await this.products.nextSequence(tx, organizationId);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = skuFromName(name, sequence);
      if (!(await this.products.findBySku(tx, organizationId, candidate))) return candidate;
      sequence += 1;
    }
    throw AppError.conflict('No se pudo generar un código único para el producto; indícalo a mano');
  }

  private async resolveUom(
    tx: Tx,
    organizationId: string,
    input: { uomId?: string | null; uomCode?: string | null },
    kind: Product['kind'],
  ): Promise<string> {
    if (input.uomId) {
      const uom = await this.uoms.findById(tx, input.uomId);
      if (!uom) throw AppError.validation('La unidad de medida indicada no existe');
      return uom.id;
    }
    if (input.uomCode) {
      const uom = await this.uoms.findByCode(tx, organizationId, input.uomCode.toUpperCase());
      if (!uom) throw AppError.validation(`No existe la unidad "${input.uomCode}"`);
      return uom.id;
    }
    // Por defecto, horas para un servicio y unidades para lo demás: es lo que
    // alguien habría elegido, y evita un campo obligatorio en el formulario.
    const code = kind === 'SERVICE' ? 'HORA' : 'UND';
    const fallback = await this.uoms.findByCode(tx, organizationId, code);
    if (!fallback) {
      throw AppError.rule(
        `No hay unidades de medida configuradas. Siembra el catálogo antes de crear productos.`,
      );
    }
    return fallback.id;
  }

  /**
   * Una unidad de venta o compra tiene que medir lo mismo que la base.
   *
   * Vender "metros" de algo que se inventaría en kilos produciría movimientos de
   * stock imposibles de conciliar, y el error aparecería meses después como un
   * inventario que no cuadra.
   */
  private async compatibleUom(
    tx: Tx,
    baseUomId: string,
    candidateId: string | null,
    role: string,
  ): Promise<string | null> {
    if (!candidateId) return null;
    const base = await this.uoms.findById(tx, baseUomId);
    const candidate = await this.uoms.findById(tx, candidateId);
    if (!candidate) throw AppError.validation(`La unidad ${role} indicada no existe`);
    if (base && candidate.dimension !== base.dimension) {
      throw AppError.rule(
        `La unidad ${role} (${candidate.code}) no mide lo mismo que la unidad del producto (${base.code})`,
      );
    }
    return candidate.id;
  }

  private async validCategory(tx: Tx, categoryId: string | null): Promise<string | null> {
    if (!categoryId) return null;
    const category = await this.categories.findById(tx, categoryId);
    if (!category) throw AppError.validation('La categoría indicada no existe');
    return category.id;
  }

  /** El IVA general de la empresa, que aplica a la compra y a la venta. */
  private async defaultSaleTaxId(tx: Tx, organizationId: string): Promise<string | null> {
    const tax = await this.taxes.findByCode(tx, organizationId, DEFAULT_SALE_TAX_CODE);
    return tax?.id ?? null;
  }

  private async assertBarcodeFree(
    tx: Tx,
    organizationId: string,
    barcode: string | null,
    excludeId: string | null,
  ): Promise<void> {
    if (!barcode) return;
    const clash = await this.products.findByBarcode(tx, organizationId, barcode);
    if (clash && clash.id !== excludeId) {
      // Dos productos con el mismo código de barras hacen que el lector de la
      // caja escoja uno al azar: el precio cobrado deja de ser predecible.
      throw AppError.conflict(`El código de barras ${barcode} ya lo usa "${clash.name}"`, {
        productId: clash.id,
      });
    }
  }
}

const taxRef = (tax: TaxRow | null): TaxRef | null =>
  tax ? { id: tax.id, code: tax.code, name: tax.name, kind: tax.kind, rate: tax.rate } : null;
