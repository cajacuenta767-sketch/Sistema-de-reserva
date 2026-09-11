import type { Mailer, MailMessage } from '../../application/ports/index.js';
import { logger } from '../../shared/logger.js';

/** Adaptador de correo para desarrollo: escribe el email en el log. */
export class ConsoleMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  async send(msg: MailMessage) {
    this.sent.push(msg);
    if (this.sent.length > 200) this.sent.shift();
    logger.info({ to: msg.to, subject: msg.subject }, '📧 email (simulado)');
  }
}
