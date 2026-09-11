import type { NotificationRepository } from '../../ports/index.js';

export class NotificationUseCases {
  constructor(private readonly notifications: NotificationRepository) {}

  async list(userId: string, unreadOnly = false) {
    const [items, unread] = await Promise.all([
      this.notifications.listForUser(userId, { unreadOnly, limit: 50 }),
      this.notifications.unreadCount(userId),
    ]);
    return { items, unread };
  }

  markRead(userId: string, ids: string[] | 'all') {
    return this.notifications.markRead(userId, ids);
  }
}
