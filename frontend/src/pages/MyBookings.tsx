import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarX2, ClipboardList, RefreshCw, Star, XCircle } from 'lucide-react';
import { get, post, del } from '@/api/client';
import type { Booking, WaitlistEntry } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { useToast } from '@/store/toast';
import { fmtDateShort } from '@/lib/format';
import { BookingCard } from '@/components/booking/BookingCard';
import { RescheduleModal } from '@/components/booking/RescheduleModal';
import { Empty, Field, Modal, PageLoader, Spinner, StarPicker, cx } from '@/components/ui';

type Tab = 'upcoming' | 'past';

export function MyBookings() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('upcoming');
  const { data, loading, reload } = useAsync(async () => {
    const [all, wait] = await Promise.all([get<{ items: Booking[] }>('/bookings', { limit: 200 }), get<{ items: WaitlistEntry[] }>('/waitlist')]);
    return { bookings: all.items, waitlist: wait.items };
  });
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelSeries, setCancelSeries] = useState(false);
  const [reschedule, setReschedule] = useState<Booking | null>(null);
  const [review, setReview] = useState<Booking | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const items = (data?.bookings ?? []).filter((b) => {
    const isFuture = new Date(b.startAt) >= now && ['PENDING', 'CONFIRMED', 'IN_PROGRESS'].includes(b.status);
    return tab === 'upcoming' ? isFuture : !isFuture;
  }).sort((a, b) => (tab === 'upcoming' ? a.startAt.localeCompare(b.startAt) : b.startAt.localeCompare(a.startAt)));

  const doCancel = async () => {
    if (!cancelTarget) return; setBusy(true);
    try { await post(`/bookings/${cancelTarget.id}/cancel`, { wholeSeries: cancelSeries }); toast('Reserva cancelada', 'success'); setCancelTarget(null); reload(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const doReview = async () => {
    if (!review) return; setBusy(true);
    try { await post('/reviews', { bookingId: review.id, rating, comment }); toast('¡Gracias por tu reseña!', 'success'); setReview(null); setComment(''); setRating(5); reload(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  if (loading && !data) return <PageLoader />;

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="section-title">Mis reservas</h1>
          <p className="text-ink-500">Gestiona tus citas, reprograma o deja una reseña.</p>
        </div>
        <Link to="/reservar" className="btn-primary">Nueva reserva</Link>
      </div>
      <div className="inline-grid grid-cols-2 gap-1 rounded-2xl bg-sand-100 p-1">
        {(['upcoming', 'past'] as Tab[]).map((t) => <button key={t} onClick={() => setTab(t)} className={cx('rounded-xl px-5 py-2 text-sm font-semibold', tab === t ? 'bg-white shadow-soft' : 'text-ink-500')}>{t === 'upcoming' ? 'Próximas' : 'Historial'}</button>)}
      </div>

      {items.length === 0 ? (
        <Empty icon={<ClipboardList className="h-7 w-7" />} title={tab === 'upcoming' ? 'No tienes citas próximas' : 'Aún no hay historial'} text="Reserva un servicio y aparecerá aquí." action={<Link to="/reservar" className="btn-primary">Reservar</Link>} />
      ) : (
        <div className="space-y-3">
          {items.map((b) => (
            <BookingCard key={b.id} booking={b} actions={
              tab === 'upcoming' ? (
                <>
                  <button onClick={() => setReschedule(b)} className="btn-secondary !py-2"><RefreshCw className="h-4 w-4" /> Reprogramar</button>
                  <button onClick={() => { setCancelTarget(b); setCancelSeries(false); }} className="btn-ghost !py-2 text-coral-600"><XCircle className="h-4 w-4" /> Cancelar</button>
                </>
              ) : b.status === 'COMPLETED' && !b.hasReview ? (
                <button onClick={() => setReview(b)} className="btn-primary !py-2"><Star className="h-4 w-4" /> Dejar reseña</button>
              ) : b.hasReview ? <span className="chip bg-emerald-100 text-emerald-800">Reseña enviada</span> : null
            } />
          ))}
        </div>
      )}

      {!!data?.waitlist.length && (
        <section className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><CalendarX2 className="h-4 w-4 text-brand-600" /> Lista de espera</h2>
          <ul className="space-y-2 text-sm">
            {data.waitlist.map((w) => (
              <li key={w.id} className="flex items-center justify-between rounded-xl bg-sand-100 px-3 py-2">
                <span>{fmtDateShort(w.date)} {w.notifiedAt && <span className="chip ml-2 bg-emerald-100 text-emerald-800">¡Hay cupo!</span>}</span>
                <button onClick={async () => { await del(`/waitlist/${w.id}`); reload(); }} className="text-xs font-semibold text-coral-600">Salir</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title="Cancelar reserva">
        <p className="text-sm text-ink-500">¿Seguro que quieres cancelar la cita del <b>{cancelTarget && fmtDateShort(cancelTarget.startAt)}</b>? Recuerda que debes hacerlo con al menos 2 horas de antelación.</p>
        {cancelTarget?.seriesId && (
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={cancelSeries} onChange={(e) => setCancelSeries(e.target.checked)} className="h-4 w-4 accent-brand-600" /> Cancelar también las citas siguientes de la serie</label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setCancelTarget(null)} className="btn-ghost">Volver</button>
          <button onClick={doCancel} disabled={busy} className="btn-danger">{busy ? <Spinner className="text-white" /> : 'Sí, cancelar'}</button>
        </div>
      </Modal>

      <RescheduleModal booking={reschedule} onClose={() => setReschedule(null)} onDone={reload} />

      <Modal open={!!review} onClose={() => setReview(null)} title="¿Qué tal estuvo tu servicio?">
        <p className="mb-4 text-sm text-ink-500">{review?.service?.name} con {review?.staff?.displayName}</p>
        <StarPicker value={rating} onChange={setRating} />
        <div className="mt-4"><Field label="Comentario"><textarea className="input min-h-28" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Cuéntanos tu experiencia…" /></Field></div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setReview(null)} className="btn-ghost">Cancelar</button>
          <button onClick={doReview} disabled={busy} className="btn-primary">{busy ? <Spinner className="text-white" /> : 'Enviar reseña'}</button>
        </div>
      </Modal>
    </div>
  );
}
