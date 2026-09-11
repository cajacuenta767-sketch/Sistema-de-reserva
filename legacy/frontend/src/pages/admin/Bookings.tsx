import { useState } from 'react';
import { get, post } from '@/api/client';
import type { Booking, BookingStatus } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { useToast } from '@/store/toast';
import { STATUS_LABEL } from '@/lib/format';
import { BookingCard } from '@/components/booking/BookingCard';
import { Empty, PageLoader, cx } from '@/components/ui';

const FILTERS: { k: string; l: string }[] = [{ k: 'upcoming', l: 'Próximas' }, { k: 'all', l: 'Todas' }, ...Object.entries(STATUS_LABEL).map(([k, l]) => ({ k, l }))];

export function AdminBookings() {
  const toast = useToast();
  const [filter, setFilter] = useState('upcoming');
  const { data, loading, reload } = useAsync(() => {
    const q: Record<string, string | boolean> = { limit: '300' } as Record<string, string>;
    if (filter === 'upcoming') q.upcoming = true; else if (filter !== 'all') q.status = filter;
    return get<{ items: Booking[]; total: number }>('/bookings', q).then((r) => r.items);
  }, [filter]);
  const setStatus = async (b: Booking, status: BookingStatus) => {
    try { await post(`/bookings/${b.id}/status`, { status }); toast('Estado actualizado', 'success'); reload(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <div className="space-y-5">
      <h1 className="section-title">Reservas</h1>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => <button key={f.k} onClick={() => setFilter(f.k)} className={cx('chip px-4 py-2', filter === f.k ? 'bg-ink-900 text-white' : 'bg-white ring-1 ring-ink-900/10 hover:bg-sand-100')}>{f.l}</button>)}
      </div>
      {loading && !data ? <PageLoader /> : !data?.length ? <Empty title="Sin reservas con ese filtro" /> : (
        <div className="space-y-3">
          {data.map((b) => (
            <BookingCard key={b.id} booking={b} showClient actions={
              <>
                {b.status === 'PENDING' && <button onClick={() => setStatus(b, 'CONFIRMED')} className="btn-secondary !py-2">Confirmar</button>}
                {(b.status === 'CONFIRMED' || b.status === 'IN_PROGRESS') && <button onClick={() => setStatus(b, 'COMPLETED')} className="btn-primary !py-2">Completar</button>}
                {b.status === 'CONFIRMED' && <button onClick={() => setStatus(b, 'NO_SHOW')} className="btn-ghost !py-2">No asistió</button>}
                {['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(b.status) && <button onClick={() => setStatus(b, 'CANCELLED')} className="btn-ghost !py-2 text-coral-600">Cancelar</button>}
              </>
            } />
          ))}
        </div>
      )}
    </div>
  );
}
