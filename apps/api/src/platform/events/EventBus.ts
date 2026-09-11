import type { Clock } from '@erp/core';
import type { Tx } from '../db/unitOfWork.js';
import type { Logger } from '../logging/logger.js';

/**
 * Bus de eventos con dos modos deliberadamente distintos.
 *
 *  · **SÍNCRONO** (`mode: 'transactional'`): el manejador corre DENTRO de la
 *    misma transacción que provocó el evento. Si falla, el cambio original se
 *    revierte. Es lo que garantiza el invariante "no existe una factura emitida
 *    sin su asiento contable". Se paga con acoplamiento temporal, así que se
 *    reserva para lo que debe ser atómico.
 *
 *  · **ASÍNCRONO** (`mode: 'eventual'`): el evento se escribe en `outbox_events`
 *    en la misma transacción y un trabajador lo entrega después, con reintentos.
 *    Es lo correcto para correos, PDF, webhooks y sincronizaciones externas: un
 *    fallo del servidor de correo no puede impedir que se emita una factura.
 *
 * En ambos casos el evento y el cambio se escriben juntos o no se escribe nada,
 * que es el problema que el patrón outbox existe para resolver.
 */

export interface DomainEvent<P = Record<string, unknown>> {
  type: string;
  aggregateType: string;
  aggregateId: string;
  organizationId: string;
  payload: P;
  actorMembershipId?: string | undefined;
  occurredAt?: Date;
}

export type EventHandler = (event: DomainEvent, tx: Tx) => Promise<void>;

export interface EventSubscription {
  /** Tipo exacto (`invoice.issued`) o comodín por prefijo (`invoice.*`). */
  eventType: string;
  /** Nombre del suscriptor; aparece en los logs y en los reintentos. */
  name: string;
  mode: 'transactional' | 'eventual';
  handler: EventHandler;
}

export const on = (
  eventType: string,
  name: string,
  handler: EventHandler,
  mode: EventSubscription['mode'] = 'eventual',
): EventSubscription => ({ eventType, name, mode, handler });

/** Atajo para lo que debe ser atómico con el cambio que lo dispara. */
export const onTransactional = (eventType: string, name: string, handler: EventHandler): EventSubscription =>
  on(eventType, name, handler, 'transactional');

const matches = (pattern: string, type: string): boolean =>
  pattern === type || (pattern.endsWith('*') && type.startsWith(pattern.slice(0, -1)));

export class EventBus {
  private readonly subscriptions: EventSubscription[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly clock: Clock,
  ) {}

  subscribe(subs: readonly EventSubscription[]): void {
    this.subscriptions.push(...subs);
  }

  subscribersFor(type: string, mode?: EventSubscription['mode']): EventSubscription[] {
    return this.subscriptions.filter(
      (s) => matches(s.eventType, type) && (mode === undefined || s.mode === mode),
    );
  }

  /**
   * Publica un evento dentro de una transacción: ejecuta los suscriptores
   * transaccionales ya mismo y encola el resto en la bandeja de salida.
   */
  async publish(tx: Tx, event: DomainEvent): Promise<void> {
    const enriched: DomainEvent = { ...event, occurredAt: event.occurredAt ?? this.clock.now() };

    for (const sub of this.subscribersFor(event.type, 'transactional')) {
      // Sin try/catch a propósito: si esto falla, la transacción entera debe caer.
      await sub.handler(enriched, tx);
    }

    const eventual = this.subscribersFor(event.type, 'eventual');
    if (eventual.length === 0) return;

    await tx.client.query(
      `INSERT INTO outbox_events
         (organization_id, event_type, aggregate_type, aggregate_id, payload, actor_membership_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        enriched.organizationId,
        enriched.type,
        enriched.aggregateType,
        enriched.aggregateId,
        JSON.stringify(enriched.payload),
        enriched.actorMembershipId ?? null,
        enriched.occurredAt,
      ],
    );
  }

  async publishAll(tx: Tx, events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(tx, event);
  }

  /** Ejecuta los suscriptores diferidos de un evento ya persistido. */
  async deliver(event: DomainEvent, tx: Tx): Promise<void> {
    for (const sub of this.subscribersFor(event.type, 'eventual')) {
      try {
        await sub.handler(event, tx);
      } catch (err) {
        // Un suscriptor diferido que falla no debe arrastrar a los demás:
        // el reintento es por evento, y el trabajador lo registra.
        this.logger.error({ err, event: event.type, subscriber: sub.name }, 'suscriptor falló');
        throw err;
      }
    }
  }

  get size(): number {
    return this.subscriptions.length;
  }
}
