import { crudPermissions, definePermission } from '@erp/contracts';
import { defineModule } from '../../platform/modules/types.js';
import { onTransactional } from '../../platform/events/EventBus.js';
import { ProductUseCases } from './application/use-cases/ProductUseCases.js';
import {
  CategoryUseCases,
  PriceListUseCases,
  TaxUseCases,
  UomUseCases,
} from './application/use-cases/CatalogUseCases.js';
import { PgProductRepository, PgVariantRepository } from './infrastructure/persistence/PgProductRepository.js';
import {
  PgCategoryRepository,
  PgTaxRepository,
  PgUomRepository,
} from './infrastructure/persistence/PgCatalogRepositories.js';
import { PgPriceListRepository } from './infrastructure/persistence/PgPriceListRepository.js';
import { catalogRoutes, productBody } from './infrastructure/http/catalog.routes.js';
import { DEFAULT_CATEGORIES } from './domain/ColombianTaxes.js';
import { newId } from '@erp/core';
import type { Tx } from '../../platform/db/unitOfWork.js';

/** Cuántas filas creó la siembra. */
export interface CatalogSeedResult {
  uoms: number;
  taxes: number;
}

/**
 * API pública del módulo, escrita a mano en vez de inferida.
 *
 * Los otros módulos la infieren con `ReturnType<typeof register>`, pero aquí eso
 * no funciona: `routes: catalogRoutes` declara su propio tipo para `api`, y
 * TypeScript lo toma como candidato de inferencia junto al de `register`,
 * quedándose con el más estrecho —el que no tiene `seedFor`—. Declararla es
 * además lo que uno querría leer para saber qué ofrece el módulo.
 */
export interface CatalogApi {
  products: ProductUseCases;
  uoms: UomUseCases;
  categories: CategoryUseCases;
  taxes: TaxUseCases;
  priceLists: PriceListUseCases;
  /** Siembra unidades, impuestos, categorías y lista de precios de una empresa nueva. */
  seedFor(tx: Tx, organizationId: string): Promise<CatalogSeedResult>;
}

export const catalogModule = defineModule<'catalog', CatalogApi>({
  id: 'catalog',

  permissions: [
    ...crudPermissions('catalog', 'product', 'productos y servicios', ['OWN', 'TEAM', 'BRANCH', 'ORG']),
    definePermission('catalog:category:manage', 'Gestionar categorías de producto'),
    definePermission('catalog:uom:read', 'Ver unidades de medida'),
    definePermission('catalog:uom:manage', 'Gestionar unidades de medida'),
    definePermission('catalog:tax:read', 'Ver impuestos'),
    definePermission('catalog:tax:manage', 'Gestionar impuestos', {
      description: 'Tarifas de IVA, INC y retenciones. Afecta al cálculo de todos los documentos.',
    }),
    definePermission('catalog:pricelist:read', 'Ver listas de precios'),
    definePermission('catalog:pricelist:manage', 'Gestionar listas de precios', {
      description: 'Quien puede cambiar precios puede cambiar el margen de toda la empresa.',
    }),
  ],

  register(ctx): CatalogApi {
    const products = new PgProductRepository();
    const variants = new PgVariantRepository();
    const uoms = new PgUomRepository();
    const categories = new PgCategoryRepository();
    const taxes = new PgTaxRepository();
    const priceLists = new PgPriceListRepository();

    return {
      products: new ProductUseCases(
        products,
        variants,
        uoms,
        categories,
        taxes,
        ctx.audit,
        ctx.events,
        ctx.clock,
      ),
      uoms: new UomUseCases(uoms, ctx.audit),
      categories: new CategoryUseCases(categories, ctx.audit),
      taxes: new TaxUseCases(taxes, ctx.audit),
      priceLists: new PriceListUseCases(priceLists, products, ctx.audit, ctx.clock),
      /** Siembra el catálogo base de una organización. Idempotente. */
      async seedFor(tx: Tx, organizationId: string): Promise<CatalogSeedResult> {
        const createdUoms = await uoms.seed(tx, organizationId);
        const createdTaxes = await taxes.seed(tx, organizationId);

        for (const name of DEFAULT_CATEGORIES) {
          if (await categories.findByPath(tx, organizationId, name)) continue;
          await categories.save(tx, organizationId, {
            id: newId(),
            parentId: null,
            name,
            path: name,
            depth: 0,
            description: null,
            isActive: true,
          });
        }

        // Lista general por defecto: sin ella, `priceFor` no tendría dónde poner
        // un precio negociado y cada venta repetiría el del producto.
        const existing = await priceLists.findDefault(tx, organizationId, 'SALE');
        if (!existing) {
          await priceLists.save(tx, {
            id: newId(),
            organizationId,
            name: 'General',
            kind: 'SALE',
            currencyCode: 'COP',
            mode: 'FIXED',
            basedOnId: null,
            adjustmentPercent: '0',
            rounding: '0',
            includesTax: false,
            validFrom: null,
            validTo: null,
            isDefault: true,
            isActive: true,
          });
        }

        return { uoms: createdUoms, taxes: createdTaxes };
      },
    };
  },

  routes: catalogRoutes,

  /** Importación de productos y servicios, por el mismo caso de uso que el alta manual. */
  imports(_ctx, api) {
    return [
      {
        entityType: 'product',
        label: 'Productos y servicios',
        permission: 'catalog:product:create',
        fields: [
          { key: 'name', label: 'Nombre', required: true, aliases: ['nombre', 'producto', 'descripcion corta', 'articulo'] },
          { key: 'sku', label: 'Código', aliases: ['sku', 'codigo', 'referencia', 'ref'] },
          { key: 'barcode', label: 'Código de barras', aliases: ['codigo de barras', 'ean', 'barras'] },
          { key: 'description', label: 'Descripción', aliases: ['descripcion', 'detalle'] },
          { key: 'kind', label: 'Tipo', aliases: ['tipo'], hint: 'GOOD (bien), SERVICE (servicio) o KIT' },
          { key: 'uomCode', label: 'Unidad', aliases: ['unidad', 'unidad de medida', 'um'], hint: 'Código: UND, KG, L, HORA…' },
          { key: 'salePrice', label: 'Precio de venta', type: 'number', aliases: ['precio', 'precio venta', 'pvp', 'valor'] },
          { key: 'purchasePrice', label: 'Precio de compra', type: 'number', aliases: ['costo', 'precio compra', 'coste'] },
          { key: 'brand', label: 'Marca', aliases: ['marca'] },
          { key: 'manufacturerSku', label: 'Referencia del fabricante', aliases: ['ref fabricante', 'codigo fabricante'] },
          { key: 'minStock', label: 'Existencias mínimas', type: 'number', aliases: ['stock minimo', 'minimo'] },
          { key: 'weightKg', label: 'Peso (kg)', type: 'number', aliases: ['peso', 'peso kg'] },
          { key: 'isActive', label: 'Activo', type: 'boolean', aliases: ['activo', 'estado'] },
        ],
        async createOne(tx, requestContext, row) {
          const input = productBody.parse({
            ...row,
            name: row.name ?? '',
            ...(row.isActive === undefined ? {} : { isActive: row.isActive === 'true' }),
          });
          const product = await api.products.create(requestContext, tx, input);
          return { id: product.id, label: `${product.sku} · ${product.name}` };
        },
      },
    ];
  },

  /**
   * El catálogo se siembra al crear la organización, en la MISMA transacción.
   *
   * Transaccional y no diferido a propósito: una empresa que existe sin unidades
   * de medida no puede crear ni un producto, y el primer intento fallaría con un
   * error que no dice qué falta. Si la siembra falla, es mejor que no exista la
   * empresa a que exista a medias.
   */
  subscriptions(_ctx, api) {
    return [
      onTransactional('organization.created', 'catalog:seed', async (event, tx) => {
        await api.seedFor(tx, event.organizationId);
      }),
    ];
  },

  search(_ctx, api) {
    return [
      {
        entityType: 'product',
        label: 'Productos y servicios',
        permission: 'catalog:product:read',
        async search(tx, requestContext, term, limit) {
          const results = await api.products.search(requestContext, tx, term, limit);
          return results.map((p) => ({
            entityType: 'product',
            id: p.id,
            title: p.name,
            subtitle: p.sku,
            url: `/productos/${p.id}`,
          }));
        },
      },
    ];
  },
});

