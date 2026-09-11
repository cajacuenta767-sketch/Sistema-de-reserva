import type { TaxDef } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type {
  ProductForPurchase,
  PurchaseCatalogReader,
} from '../../application/use-cases/PurchaseUseCases.js';
import type { WithholdingReader } from '../../application/use-cases/BillUseCases.js';

/**
 * Lectura del catálogo para comprar.
 *
 * Consulta las tablas en vez de pasar por la API de `catalog`: lo que hace
 * falta son seis columnas y el impuesto de compra, y el caso de uso del otro
 * módulo traería precios de venta, variantes y listas de precios para tirarlos.
 * La regla que importa —no importar CÓDIGO de otro módulo— se respeta.
 */
export class PgPurchaseCatalogReader implements PurchaseCatalogReader {
  async forPurchase(tx: Tx, ids: readonly string[]): Promise<Map<string, ProductForPurchase>> {
    if (ids.length === 0) return new Map();
    const { rows } = await tx.client.query<{
      id: string;
      sku: string | null;
      name: string;
      purchase_price: string;
      currency_code: string;
      uom_code: string;
      track_inventory: boolean;
      tax_id: string | null;
      tax_code: string | null;
      tax_kind: string | null;
      tax_rate: string | null;
    }>(
      `SELECT p.id, p.sku, p.name, p.purchase_price::text AS purchase_price, p.currency_code,
              um.code AS uom_code, p.track_inventory,
              t.id AS tax_id, t.code AS tax_code, t.kind AS tax_kind,
              trim_scale(t.rate)::text AS tax_rate
         FROM products p
         JOIN uoms um ON um.id = p.uom_id
         LEFT JOIN taxes t ON t.id = p.purchase_tax_id
        WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL`,
      [[...ids]],
    );

    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          sku: r.sku,
          name: r.name,
          purchasePrice: r.purchase_price,
          currencyCode: r.currency_code,
          uomCode: r.uom_code,
          trackInventory: r.track_inventory,
          purchaseTax:
            r.tax_id && r.tax_code && r.tax_kind && r.tax_rate
              ? {
                  id: r.tax_id,
                  code: r.tax_code,
                  kind: r.tax_kind as TaxDef['kind'],
                  rate: r.tax_rate,
                  isWithholding: r.tax_kind.startsWith('WITHHOLDING'),
                }
              : null,
        },
      ]),
    );
  }
}

export class PgWithholdingReader implements WithholdingReader {
  async byIds(tx: Tx, ids: readonly string[]): Promise<TaxDef[]> {
    if (ids.length === 0) return [];
    const { rows } = await tx.client.query<{
      id: string;
      code: string;
      kind: string;
      rate: string;
    }>(
      `SELECT id, code, kind, trim_scale(rate)::text AS rate
         FROM taxes
        WHERE id = ANY($1::uuid[]) AND is_withholding AND is_active
        ORDER BY code`,
      [[...ids]],
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      kind: r.kind as TaxDef['kind'],
      rate: r.rate,
      isWithholding: true,
    }));
  }

  async defaultPurchaseWithholdings(tx: Tx): Promise<TaxDef[]> {
    const { rows } = await tx.client.query<{
      id: string;
      code: string;
      kind: string;
      rate: string;
    }>(
      `SELECT id, code, kind, trim_scale(rate)::text AS rate
         FROM taxes WHERE is_withholding AND is_active ORDER BY code`,
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      kind: r.kind as TaxDef['kind'],
      rate: r.rate,
      isWithholding: true,
    }));
  }
}
