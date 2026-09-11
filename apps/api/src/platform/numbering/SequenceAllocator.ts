import { AppError, newId } from '@erp/core';
import type { Tx } from '../db/unitOfWork.js';

export interface SequenceKey {
  organizationId: string;
  docType: string;
  prefix?: string;
  branchId?: string | null;
}

export interface AllocatedNumber {
  number: number;
  prefix: string;
  /** Representación completa, p. ej. `FV-000123`. */
  formatted: string;
}

const periodKeyFor = (scope: string, date: Date): string => {
  if (scope === 'YEAR') return String(date.getUTCFullYear());
  if (scope === 'MONTH') return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return '';
};

/**
 * Asigna consecutivos de documento sin huecos ni repeticiones.
 *
 * `SELECT ... FOR UPDATE` serializa a quienes pidan el MISMO contador, y solo a
 * ellos: dos facturas simultáneas esperan una a otra, pero una factura y una
 * orden de compra no se estorban. Un `UPDATE ... RETURNING` sin bloqueo previo
 * también funcionaría, pero el bloqueo explícito deja clara la intención y
 * permite validar el rango antes de consumir el número.
 *
 * Se asigna DENTRO de la transacción del documento: si la factura no se guarda,
 * el número no se consume y no queda un hueco que explicar a la DIAN.
 */
export class SequenceAllocator {
  /** `at` es la fecha del DOCUMENTO, no la del reloj: el consecutivo de una
   *  factura de enero pertenece a enero aunque se registre en febrero. */
  async next(tx: Tx, key: SequenceKey, at: Date): Promise<AllocatedNumber> {
    const branchId = key.branchId ?? null;

    /*
     * Selección de la numeración, en dos ejes:
     *
     * · **Prefijo.** Quien pide un número nombra el TIPO de documento, no su
     *   prefijo: el prefijo es configuración y vive en la tabla. Exigírselo al
     *   código lo obligaría a repetir un dato que un administrador puede cambiar
     *   desde la pantalla, y el día que lo cambiara dejaría de emitirse. Solo se
     *   filtra por prefijo cuando el llamante pide uno concreto, que es el caso
     *   de una empresa con dos resoluciones DIAN a la vez.
     *
     * · **Sucursal.** Gana la numeración propia de la sucursal si existe, y si
     *   no se usa la de la empresa. La mayoría lleva un solo consecutivo; quien
     *   necesita uno por establecimiento lo crea y pasa a usarse solo.
     */
    const { rows } = await tx.client.query<{
      id: string;
      next_number: string;
      padding: number;
      period_scope: string;
      period_key: string;
      range_from: string | null;
      range_to: string | null;
      is_active: boolean;
      prefix: string;
    }>(
      `SELECT id, prefix, next_number, padding, period_scope, period_key, range_from, range_to, is_active
         FROM document_sequences
        WHERE organization_id = $1 AND doc_type = $2
          AND ($3::text IS NULL OR prefix = $3)
          AND (branch_id IS NULL OR branch_id = $4::uuid)
        ORDER BY (branch_id IS NOT NULL) DESC, prefix
        LIMIT 1
        FOR UPDATE`,
      [key.organizationId, key.docType, key.prefix ?? null, branchId],
    );

    const seq = rows[0];
    if (!seq) {
      throw AppError.rule(
        `No hay una numeración configurada para "${key.docType}"` +
          (key.prefix ? ` con prefijo "${key.prefix}"` : ''),
      );
    }
    // El prefijo sale de la fila elegida, no de quien pide el número.
    const prefix = seq.prefix;
    if (!seq.is_active) {
      throw AppError.rule(`La numeración de "${key.docType}" está desactivada`);
    }

    const wantedPeriod = periodKeyFor(seq.period_scope, at);
    // Al cambiar de periodo el contador vuelve a empezar (o al inicio del rango).
    const resetting = seq.period_scope !== 'NEVER' && wantedPeriod !== seq.period_key;
    const number = resetting ? Number(seq.range_from ?? 1) : Number(seq.next_number);

    const rangeTo = seq.range_to === null ? null : Number(seq.range_to);
    if (rangeTo !== null && number > rangeTo) {
      throw AppError.rule(
        `Se agotó el rango autorizado de numeración para "${key.docType}" (hasta ${rangeTo}). ` +
          'Solicita una resolución nueva antes de seguir facturando.',
      );
    }

    await tx.client.query('UPDATE document_sequences SET next_number = $2, period_key = $3 WHERE id = $1', [
      seq.id,
      number + 1,
      wantedPeriod,
    ]);

    return {
      number,
      prefix,
      formatted: `${prefix}${String(number).padStart(seq.padding, '0')}`,
    };
  }

  /** Crea o actualiza un contador. Idempotente, para semillas y configuración. */
  async ensure(
    tx: Tx,
    key: SequenceKey & {
      startAt?: number;
      padding?: number;
      periodScope?: 'NEVER' | 'YEAR' | 'MONTH';
      rangeFrom?: number;
      rangeTo?: number;
    },
  ): Promise<string> {
    const id = newId();
    const { rows } = await tx.client.query<{ id: string }>(
      `INSERT INTO document_sequences
         (id, organization_id, branch_id, doc_type, prefix, next_number, padding, period_scope, range_from, range_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (organization_id, doc_type, prefix, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
       DO UPDATE SET padding = EXCLUDED.padding, period_scope = EXCLUDED.period_scope,
                     range_from = EXCLUDED.range_from, range_to = EXCLUDED.range_to
       RETURNING id`,
      [
        id,
        key.organizationId,
        key.branchId ?? null,
        key.docType,
        key.prefix ?? '',
        key.startAt ?? key.rangeFrom ?? 1,
        key.padding ?? 6,
        key.periodScope ?? 'NEVER',
        key.rangeFrom ?? null,
        key.rangeTo ?? null,
      ],
    );
    return rows[0]?.id ?? id;
  }
}
