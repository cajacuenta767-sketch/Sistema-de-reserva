import type { Logger } from '../logging/logger.js';

export interface JobDefinition<T = Record<string, unknown>> {
  name: string;
  /** Expresión cron para trabajos periódicos. Si falta, es un trabajo bajo demanda. */
  schedule?: string;
  handler: (payload: T) => Promise<void>;
}

export interface JobQueue {
  register(jobs: readonly JobDefinition[]): void;
  enqueue(name: string, payload?: Record<string, unknown>): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  definitions(): readonly JobDefinition[];
}

/**
 * Cola en memoria: ejecuta al momento y registra los trabajos periódicos sin
 * dispararlos. Es lo que usan los tests y el arranque sin base de datos de
 * trabajos; en producción se sustituye por el adaptador de pg-boss sin que
 * ningún módulo cambie, porque todos hablan con esta interfaz.
 */
export class InMemoryJobQueue implements JobQueue {
  private readonly jobs = new Map<string, JobDefinition>();

  constructor(private readonly logger: Logger) {}

  register(jobs: readonly JobDefinition[]): void {
    for (const job of jobs) {
      if (this.jobs.has(job.name)) throw new Error(`El trabajo "${job.name}" está registrado dos veces`);
      this.jobs.set(job.name, job as JobDefinition);
    }
  }

  async enqueue(name: string, payload: Record<string, unknown> = {}): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Trabajo desconocido: ${name}`);
    try {
      await job.handler(payload);
    } catch (err) {
      this.logger.error({ err, job: name }, 'trabajo falló');
      throw err;
    }
  }

  async start(): Promise<void> {
    this.logger.debug({ jobs: this.jobs.size }, 'cola de trabajos en memoria lista');
  }

  async stop(): Promise<void> {
    /* nada que detener */
  }

  definitions(): readonly JobDefinition[] {
    return [...this.jobs.values()];
  }
}
