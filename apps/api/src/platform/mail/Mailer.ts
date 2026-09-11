import type { Clock } from '@erp/core';
import type { Logger } from '../logging/logger.js';

export interface MailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Adaptador de desarrollo: escribe el correo en el log y lo guarda en memoria,
 * para que la bandeja simulada del panel de administración pueda mostrarlo.
 */
export class ConsoleMailer implements Mailer {
  private readonly outbox: Array<MailMessage & { sentAt: Date }> = [];

  constructor(
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly limit = 200,
  ) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.info({ to: message.to, subject: message.subject }, 'correo simulado (adaptador de consola)');
    this.outbox.unshift({ ...message, sentAt: this.clock.now() });
    if (this.outbox.length > this.limit) this.outbox.length = this.limit;
  }

  sent(): ReadonlyArray<MailMessage & { sentAt: Date }> {
    return this.outbox;
  }

  clear(): void {
    this.outbox.length = 0;
  }
}
