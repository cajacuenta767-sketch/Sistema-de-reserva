import { Bell, CheckCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { get, post } from '@/api/client';
import type { Notification } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { Empty, PageLoader, cx } from '@/components/ui';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export function Notifications() {
  const { data, loading, reload } = useAsync(() => get<{ items: Notification[]; unread: number }>('/notifications'));
  const markAll = async () => { await post('/notifications/read', { ids: 'all' }); reload(); };
  const markOne = async (id: string) => { await post('/notifications/read', { ids: [id] }); reload(); };
  if (loading && !data) return <PageLoader />;
  return (
    <div className="mx-auto max-w-2xl space-y-5 animate-fade-up">
      <div className="flex items-center justify-between">
        <h1 className="section-title">Notificaciones</h1>
        {!!data?.unread && <button onClick={markAll} className="btn-ghost text-brand-700"><CheckCheck className="h-4 w-4" /> Marcar todas leídas</button>}
      </div>
      {!data?.items.length ? (
        <Empty icon={<Bell className="h-7 w-7" />} title="Sin notificaciones" text="Aquí verás confirmaciones, recordatorios y novedades de tus reservas." />
      ) : (
        <ul className="space-y-2">
          {data.items.map((n) => {
            const bookingId = n.data.bookingId as string | undefined;
            return (
              <li key={n.id} className={cx('card flex gap-4 p-4 transition', !n.readAt && 'ring-2 ring-brand-500/30')} onClick={() => !n.readAt && markOne(n.id)}>
                <span className={cx('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', n.readAt ? 'bg-sand-300' : 'bg-brand-500')} />
                <div className="flex-1">
                  <p className="font-semibold">{n.title}</p>
                  <p className="text-sm text-ink-500">{n.body}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-ink-300">
                    <span>{formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: es })}</span>
                    {bookingId && <Link to="/mis-reservas" className="font-semibold text-brand-700">Ver reserva</Link>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
