import { AppError, type Clock } from '@erp/core';
import type { TaxDef } from '@erp/core';
import type { Tx } from '../../../../platform/db/unitOfWork.js';
import type { RequestContext } from '../../../../platform/authz/RequestContext.js';
import {
  computeDocumentTotals,
  type DocumentLineInput,
  type SalesDocumentTotals,
} from '../../domain/DocumentTotals.js';
import type { WithholdingDef } from '../../domain/Withholding.js';
import type { StoredLine, StoredWithholding } from '../ports/SalesRepositories.js';

/**
 * Compone las líneas de un documento a partir de lo que envía el cliente.
 *
 * Resuelve contra el catálogo lo que la línea no trae —descripción, código,
 * unidad, impuesto— y lo COPIA en la línea. Ese copiado es lo que hace que una
 * factura de 2026 siga diciendo lo mismo en 2030, aunque el producto se haya
 * renombrado y el IVA haya cambiado dos veces.
 *
 * Lo que el cliente sí manda manda: si envía un precio, se respeta. El
 * comercial negocia, y un sistema que le sobrescriba el precio con el de la
 * lista le obliga a facturar a mano.
 */

export interface LineRequest {
  productId?: string | null;
  variantId?: string | null;
  description?: string;
  quantity: string;
  unitPrice?: string;
  discountPercent?: string;
  /** Impuesto explícito; si falta, se toma el del producto. */
  taxId?: string | null;
}

/** La parte del catálogo que ventas necesita. Se recibe por inyección para no
 *  acoplar los casos de uso a la forma interna de ese módulo. */
export interface CatalogReader {
  forDocument(
    ctx: RequestContext,
    tx: Tx,
    ids: readonly string[],
  ): Promise<
    Array<{
      id: string;
      sku: string;
      name: string;
      uomCode: string;
      salePrice: string;
      saleTax: { id: string; code: string; kind: string; rate: string } | null;
    }>
  >;
}

export interface TaxReader {
  list(
    ctx: RequestContext,
    tx: Tx,
  ): Promise<
    Array<{
      id: string;
      code: string;
      name: string;
      kind: string;
      rate: string;
      is_withholding: boolean;
      applies_to: string;
      min_base: string | null;
      is_active: boolean;
    }>
  >;
}

export interface BuiltDocument {
  totals: SalesDocumentTotals;
  lines: Omit<StoredLine, 'id'>[];
  withholdings: StoredWithholding[];
}

export class DocumentBuilder {
  constructor(
    private readonly catalog: () => CatalogReader,
    private readonly taxes: () => TaxReader,
    private readonly clock: Clock,
  ) {}

  async build(
    ctx: RequestContext,
    tx: Tx,
    input: {
      lines: readonly LineRequest[];
      currency: string;
      globalDiscountPercent?: string;
      /** Códigos de retención a aplicar. Vacío = ninguna. */
      withholdingCodes?: readonly string[];
    },
  ): Promise<BuiltDocument> {
    if (input.lines.length === 0) throw AppError.rule('Un documento necesita al menos una línea');

    // Una sola consulta al catálogo para todas las líneas.
    const productIds = [...new Set(input.lines.map((l) => l.productId).filter((id): id is string => Boolean(id)))];
    const products = new Map(
      (productIds.length > 0 ? await this.catalog().forDocument(ctx, tx, productIds) : []).map((p) => [p.id, p]),
    );

    const missing = productIds.filter((id) => !products.has(id));
    if (missing.length > 0) {
      throw AppError.validation(
        `${missing.length === 1 ? 'Un producto de las líneas no existe' : `${missing.length} productos de las líneas no existen`} o fueron archivados`,
        { productIds: missing },
      );
    }

    const allTaxes = await this.taxes().list(ctx, tx);
    const taxById = new Map(allTaxes.map((t) => [t.id, t]));

    const domainLines: DocumentLineInput[] = input.lines.map((line, index) => {
      const product = line.productId ? products.get(line.productId) : undefined;

      const description = line.description?.trim() || product?.name;
      if (!description) {
        throw AppError.rule(
          `La línea ${index + 1} no tiene descripción y tampoco un producto del que tomarla`,
        );
      }

      // El precio del cliente manda; el del producto es el valor por defecto.
      const unitPrice = line.unitPrice ?? product?.salePrice;
      if (unitPrice === undefined) {
        throw AppError.rule(`La línea ${index + 1} necesita un precio`);
      }

      const taxRef = line.taxId === undefined ? product?.saleTax : line.taxId ? taxById.get(line.taxId) : null;
      if (line.taxId && !taxRef) throw AppError.validation(`El impuesto de la línea ${index + 1} no existe`);

      const taxes: TaxDef[] = taxRef
        ? [
            {
              id: taxRef.id,
              code: taxRef.code,
              kind: taxRef.kind as TaxDef['kind'],
              rate: taxRef.rate,
              isWithholding: false,
            },
          ]
        : [];

      return {
        productId: line.productId ?? null,
        variantId: line.variantId ?? null,
        description,
        quantity: line.quantity,
        unitPrice,
        ...(line.discountPercent ? { discountPercent: line.discountPercent } : {}),
        taxes,
      };
    });

    const withholdings = this.resolveWithholdings(allTaxes, input.withholdingCodes ?? []);

    const totals = computeDocumentTotals({
      lines: domainLines,
      currency: input.currency,
      ...(input.globalDiscountPercent ? { globalDiscountPercent: input.globalDiscountPercent } : {}),
      withholdings,
    });

    const stored: Omit<StoredLine, 'id'>[] = totals.lines.map((computed, index) => {
      const request = input.lines[index]!;
      const product = request.productId ? products.get(request.productId) : undefined;
      const domain = domainLines[index]!;

      return {
        position: index + 1,
        productId: request.productId ?? null,
        variantId: request.variantId ?? null,
        description: domain.description,
        sku: product?.sku ?? null,
        uomCode: product?.uomCode ?? null,
        quantity: request.quantity,
        unitPrice: domain.unitPrice,
        discountPercent: request.discountPercent ?? '0',
        gross: computed.gross.toDb(),
        discountAmount: computed.discount.toDb(),
        subtotal: computed.subtotal.toDb(),
        taxTotal: computed.taxTotal.toDb(),
        total: computed.total.toDb(),
        taxes: computed.taxes.map((t) => ({
          taxId: t.taxId,
          code: t.code,
          kind: t.kind,
          rate: t.rate,
          base: t.base.toDb(),
          amount: t.amount.toDb(),
        })),
      };
    });

    return {
      totals,
      lines: stored,
      // Las retenciones con importe cero se guardan igual: la ficha explica por
      // qué no se retuvo ("la base no llega al mínimo"), que es la pregunta que
      // hace el contador al revisar.
      withholdings: totals.withholdings.map((w) => ({
        taxId: w.taxId,
        code: w.code,
        name: w.name,
        kind: w.kind,
        rate: w.rate,
        base: w.base.toDb(),
        amount: w.amount.toDb(),
      })),
    };
  }

  private resolveWithholdings(
    all: Awaited<ReturnType<TaxReader['list']>>,
    codes: readonly string[],
  ): WithholdingDef[] {
    if (codes.length === 0) return [];

    return codes.map((code) => {
      const tax = all.find((t) => t.code === code);
      if (!tax) throw AppError.validation(`No existe la retención "${code}"`);
      if (!tax.is_withholding) throw AppError.rule(`"${code}" no es una retención`);
      if (!tax.is_active) throw AppError.rule(`La retención "${code}" está desactivada`);

      return {
        id: tax.id,
        code: tax.code,
        name: tax.name,
        kind: tax.kind as WithholdingDef['kind'],
        rate: tax.rate,
        minBase: tax.min_base,
      };
    });
  }

  today(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }
}
