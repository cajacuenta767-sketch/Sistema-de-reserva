import type pg from 'pg';
import { withTenant } from '../db/tenancy.js';
import type { Logger } from '../logging/logger.js';
import type { DomainEvent, EventBus } from './EventBus.js';

const MAX_ATTEMPTS = 5;

interface OutboxRow {
  id: string;
  organization_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  actor_membership_id: string | null;
  occurred_at: Date;
  attempts: number;
}

/**
 * Vacía la bandeja de salida.
 *
 * `FOR UPDATE SKIP LOCKED` permite que varios trabajadores procesen en paralelo
 * sin pisarse ni bloquearse: cada uno toma los eventos que otro no haya tomado.
 */
export const drainOutbox = async (
  pool: pg.Pool,
  bus: EventBus,
  logger: Logger,
  batchSize = 50,
): Promise<{ processed: number; failed: number }> => {
  const client = await pool.connect();
  let rows: OutboxRow[];
  try {
    const result = await client.query<OutboxRow>(
      `SELECT id, organization_id, event_type, aggregate_type, aggregate_id,
              payload, actor_membership_id, occurred_at, attempts
         FROM outbox_events
        WHERE processed_at IS NULL AND attempts < $1
        ORDER BY occurred_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [MAX_ATTEMPTS, batchSize],
    );
    rows = result.rows;
  } finally {
    client.release();
  }

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    const event: DomainEvent = {
      type: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      organizationId: row.organization_id,
      payload: row.payload,
      actorMembershipId: row.actor_membership_id ?? undefined,
      occurredAt: row.occurred_at,
    };

    try {
      // El manejador corre con el tenant del evento: un suscriptor no puede
      // tocar datos de otra organización ni por error.
      await withTenant(pool, { organizationId: row.organization_id }, async (tx) => {
        await bus.deliver(event, tx);
        await tx.client.query('UPDATE outbox_events SET processed_at = now() WHERE id = $1', [row.id]);
      });
      processed++;
    } catch (err) {
      failed++;
      await pool.query('UPDATE outbox_events SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [
        row.id,
        (err as Error).message.slice(0, 1000),
      ]);
      logger.warn(
        { eventId: row.id, type: row.event_type, attempts: row.attempts + 1 },
        'evento de la bandeja de salida falló',
      );
    }
  }

  return { processed, failed };
};
