import type { Notification, NotificationType } from '../../domain/entities/Notification.js';
import { newId } from '../../shared/id.js';
import type { Clock } from '../../shared/Clock.js';
import type { Mailer, NotificationRepository, UserRepository } from '../ports/index.js';

/**
 * Publica notificaciones in-app y, si el usuario tiene email, un correo.
 * Los errores del mailer nunca deben romper el caso de uso principal.
 */
export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly users: UserRepository,
    private readonly mailer: Mailer,
    private readonly clock: Clock,
  ) {}

  async notify(userId: string, type: NotificationType, title: string, body: string, data: Record<string, unknown> = {}) {
    const n: Notification = {
      id: newId(),
      userId,
      type,
      title,
      body,
      data,
      readAt: null,
      createdAt: this.clock.now().toISOString(),
    };
    await this.notifications.save(n);
    const user = await this.users.findById(userId);
    if (user?.email) {
      try {
        await this.mailer.send({ to: user.email, subject: title, text: body });
      } catch {
        /* el email es best-effort */
      }
    }
    return n;
  }
}
