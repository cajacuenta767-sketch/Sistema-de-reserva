import type { Tx } from '../db/unitOfWork.js';
import { actorMembershipId, type RequestContext } from '../authz/RequestContext.js';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'POST' | 'VOID' | 'LOGIN' | 'EXPORT';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/** Campos que nunca deben quedar registrados en la auditoría. */
const REDACTED = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'tokenHash',
  'token_hash',
  'totpSecret',
  'totp_secret',
  'keyHash',
  'key_hash',
]);

const sanitize = (obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null => {
  if (!obj) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = REDACTED.has(k) ? '[redactado]' : v;
  return out;
};

/**
 * Campos que nunca cuentan como "cambio".
 *
 * `updatedAt` cambia por definición en cada actualización, así que listarlo como
 * campo modificado es ruido puro. Además, el disparador de la base lo fija con
 * el `now()` de PostgreSQL mientras la entidad lo lleva del reloj inyectado:
 * con un reloj fijo los dos valores difieren siempre y toda actualización
 * parecería tener cambios, incluso una que no cambia nada.
 */
const NOT_A_CHANGE = new Set(['updatedAt', 'updated_at', 'createdAt', 'created_at']);

/**
 * Calcula qué cambió realmente. Registrar "se actualizó la factura" sin decir
 * qué campo no sirve de nada cuando hay que explicar por qué cuadró distinto.
 */
export const diffFields = (
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] => {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (NOT_A_CHANGE.has(key)) continue;
    const a = before[key];
    const b = after[key];
    if (a instanceof Date && b instanceof Date) {
      if (a.getTime() !== b.getTime()) changed.push(key);
    } else if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      changed.push(key);
    }
  }
  return changed.sort();
};

/**
 * Auditoría inmutable, escrita en la MISMA transacción que el cambio.
 *
 * La tabla tiene reglas que anulan UPDATE y DELETE: una auditoría que se puede
 * editar no es una auditoría. Y al ir en la transacción, no existe un cambio
 * registrado sin su rastro ni un rastro de un cambio que se revirtió.
 */
export class AuditRecorder {
  async record(tx: Tx, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    const before = sanitize(entry.before);
    const after = sanitize(entry.after);
    const changed = entry.action === 'UPDATE' ? diffFields(before, after) : [];

    // Un UPDATE que no cambió nada no merece una fila de auditoría.
    if (entry.action === 'UPDATE' && changed.length === 0) return;

    await tx.client.query(
      `INSERT INTO audit_logs
         (organization_id, actor_membership_id, actor_label, actor_ip, request_id,
          action, entity_type, entity_id, entity_label, before, after, changed_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::text[])`,
      [
        ctx.organizationId,
        actorMembershipId(ctx),
        ctx.user.fullName,
        ctx.ip ?? null,
        ctx.requestId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        entry.entityLabel ?? null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        changed,
      ],
    );
  }

  /**
   * Registra sin `RequestContext`, para los eventos que ocurren ANTES de que
   * exista uno: inicio de sesión, aceptación de invitación, registro. La tabla
   * tiene RLS, así que la transacción debe traer el tenant ya fijado.
   */
  async recordRaw(
    tx: Tx,
    input: {
      organizationId: string;
      actorMembershipId?: string | null;
      actorLabel?: string | null;
      ip?: string | null;
      requestId?: string | null;
    } & AuditEntry,
  ): Promise<void> {
    await tx.client.query(
      `INSERT INTO audit_logs
         (organization_id, actor_membership_id, actor_label, actor_ip, request_id,
          action, entity_type, entity_id, entity_label, before, after, changed_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::text[])`,
      [
        input.organizationId,
        input.actorMembershipId ?? null,
        input.actorLabel ?? null,
        input.ip ?? null,
        input.requestId ?? null,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.entityLabel ?? null,
        input.before ? JSON.stringify(sanitize(input.before)) : null,
        input.after ? JSON.stringify(sanitize(input.after)) : null,
        [],
      ],
    );
  }

  /**
   * Envuelve una operación de escritura para auditarla sin que el caso de uso
   * tenga que acordarse. El coste marginal por módulo nuevo es cero, que es la
   * única forma de que la auditoría siga siendo completa dentro de un año.
   */
  async around<T>(
    tx: Tx,
    ctx: RequestContext,
    entry: Omit<AuditEntry, 'after'>,
    operation: () => Promise<T>,
    describe: (result: T) => Record<string, unknown> | null = () => null,
  ): Promise<T> {
    const result = await operation();
    await this.record(tx, ctx, { ...entry, after: describe(result) });
    return result;
  }
}
