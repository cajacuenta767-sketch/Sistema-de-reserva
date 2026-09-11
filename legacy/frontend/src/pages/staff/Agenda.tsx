import { useState } from 'react';
import { addDays } from 'date-fns';
import { CalendarOff, ChevronLeft, ChevronRight, Play, CheckCheck, UserX, Plus, Trash2 } from 'lucide-react';
import { get, post, put, del } from '@/api/client';
import type { Booking, BookingStatus, TimeOff, WorkingHours } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { useAuth } from '@/store/auth';
import { useToast } from '@/store/toast';
import { WEEKDAYS_LONG, capitalize, fmtDate, toLocalDate, fmtDateTime } from '@/lib/format';
import { BookingCard } from '@/components/booking/BookingCard';
import { Empty, Field, Modal, PageLoader, Spinner, StatTile, cx } from '@/components/ui';

export function Agenda() {
  const { staffProfile } = useAuth();
  const toast = useToast();
  const [day, setDay] = useState(new Date());
  const date = toLocalDate(day);
  const { data, loading, reload } = useAsync(
    () => get<{ items: Booking[] }>('/bookings', { from: `${date}T00:00`, to: `${date}T23:59`, limit: 200 }).then((r) => r.items),
    [date],
  );
  const setStatus = async (b: Booking, status: BookingStatus) => {
    try { await post(`/bookings/${b.id}/status`, { status }); toast('Estado actualizado', 'success'); reload(); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  const active = (data ?? []).filter((b) => !['CANCELLED'].includes(b.status));
  const [tab, setTab] = useState<'agenda' | 'horario'>('agenda');

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="section-title">Mi agenda</h1>
          <p className="text-ink-500">Hola, {staffProfile?.displayName}. Gestiona tus citas y tu horario.</p>
        </div>
        <div className="inline-grid grid-cols-2 gap-1 rounded-2xl bg-sand-100 p-1">
          {(['agenda', 'horario'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cx('rounded-xl px-5 py-2 text-sm font-semibold', tab === t ? 'bg-white shadow-soft' : 'text-ink-500')}>{t === 'agenda' ? 'Agenda' : 'Horario y bloqueos'}</button>)}
        </div>
      </div>

      {tab === 'agenda' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Citas del día" value={active.length} accent="brand" />
            <StatTile label="Completadas" value={active.filter((b) => b.status === 'COMPLETED').length} accent="sky" />
            <StatTile label="Valoración" value={staffProfile?.ratingAvg ? staffProfile.ratingAvg.toFixed(1) : '—'} sub={`${staffProfile?.ratingCount ?? 0} reseñas · ${staffProfile?.completedJobs ?? 0} trabajos`} accent="amber" />
          </div>
          <div className="card flex items-center justify-between p-3">
            <button onClick={() => setDay(addDays(day, -1))} className="btn-ghost !p-2" aria-label="Día anterior"><ChevronLeft className="h-5 w-5" /></button>
            <div className="text-center">
              <p className="font-display text-lg font-semibold">{capitalize(fmtDate(date, "EEEE d 'de' MMMM"))}</p>
              <button onClick={() => setDay(new Date())} className="text-xs font-semibold text-brand-700">Ir a hoy</button>
            </div>
            <button onClick={() => setDay(addDays(day, 1))} className="btn-ghost !p-2" aria-label="Día siguiente"><ChevronRight className="h-5 w-5" /></button>
          </div>
          {loading && !data ? <PageLoader /> : active.length === 0 ? (
            <Empty icon={<CalendarOff className="h-7 w-7" />} title="Sin citas este día" text="Disfruta el descanso o revisa otro día." />
          ) : (
            <div className="space-y-3">
              {active.map((b) => (
                <BookingCard key={b.id} booking={b} showClient actions={
                  <>
                    {b.status === 'PENDING' && <button onClick={() => setStatus(b, 'CONFIRMED')} className="btn-secondary !py-2">Confirmar</button>}
                    {b.status === 'CONFIRMED' && <button onClick={() => setStatus(b, 'IN_PROGRESS')} className="btn-secondary !py-2"><Play className="h-4 w-4" /> Iniciar</button>}
                    {(b.status === 'CONFIRMED' || b.status === 'IN_PROGRESS') && <button onClick={() => setStatus(b, 'COMPLETED')} className="btn-primary !py-2"><CheckCheck className="h-4 w-4" /> Completar</button>}
                    {b.status === 'CONFIRMED' && <button onClick={() => setStatus(b, 'NO_SHOW')} className="btn-ghost !py-2 text-coral-600"><UserX className="h-4 w-4" /> No asistió</button>}
                  </>
                } />
              ))}
            </div>
          )}
        </>
      ) : staffProfile ? <ScheduleEditor staffId={staffProfile.id} /> : null}
    </div>
  );
}

export function ScheduleEditor({ staffId }: { staffId: string }) {
  const toast = useToast();
  const { data, loading, reload } = useAsync(async () => {
    const [h, t] = await Promise.all([get<{ items: WorkingHours[] }>(`/staff/${staffId}/working-hours`), get<{ items: TimeOff[] }>(`/staff/${staffId}/time-off`)]);
    return { hours: h.items, timeOff: t.items };
  }, [staffId]);
  const [hours, setHours] = useState<Omit<WorkingHours, 'id' | 'staffId'>[] | null>(null);
  const [offOpen, setOffOpen] = useState(false);
  const [off, setOff] = useState({ startAt: '', endAt: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const list = hours ?? data?.hours ?? [];

  const saveHours = async () => {
    setBusy(true);
    try { await put(`/staff/${staffId}/working-hours`, { hours: list }); toast('Horario guardado', 'success'); setHours(null); reload(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const addOff = async () => {
    setBusy(true);
    try { await post(`/staff/${staffId}/time-off`, { ...off, reason: off.reason || null }); toast('Bloqueo añadido', 'success'); setOffOpen(false); setOff({ startAt: '', endAt: '', reason: '' }); reload(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  if (loading && !data) return <PageLoader />;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card space-y-3 p-5">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Horario semanal</h2><button onClick={saveHours} disabled={busy || !hours} className="btn-primary !py-2">{busy ? <Spinner className="text-white" /> : 'Guardar'}</button></div>
        {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
          const ranges = list.map((h, i) => ({ ...h, i })).filter((h) => h.weekday === wd);
          return (
            <div key={wd} className="rounded-2xl bg-sand-100/70 p-3">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold">{WEEKDAYS_LONG[wd]}</span><button onClick={() => setHours([...list, { weekday: wd, startTime: '09:00', endTime: '13:00' }])} className="text-xs font-semibold text-brand-700"><Plus className="inline h-3.5 w-3.5" /> Rango</button></div>
              {ranges.length === 0 && <p className="text-xs text-ink-300">Descanso</p>}
              {ranges.map((r) => (
                <div key={r.i} className="mt-2 flex items-center gap-2 text-sm">
                  <input type="time" className="input !w-auto !py-1.5" value={r.startTime} onChange={(e) => setHours(list.map((h, i) => (i === r.i ? { ...h, startTime: e.target.value } : h)))} />
                  <span>–</span>
                  <input type="time" className="input !w-auto !py-1.5" value={r.endTime} onChange={(e) => setHours(list.map((h, i) => (i === r.i ? { ...h, endTime: e.target.value } : h)))} />
                  <button onClick={() => setHours(list.filter((_, i) => i !== r.i))} className="ml-auto text-ink-300 hover:text-coral-600" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          );
        })}
      </section>
      <section className="card space-y-3 p-5">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Bloqueos y vacaciones</h2><button onClick={() => setOffOpen(true)} className="btn-secondary !py-2"><Plus className="h-4 w-4" /> Añadir</button></div>
        {data?.timeOff.length === 0 && <p className="text-sm text-ink-500">No tienes bloqueos.</p>}
        <ul className="space-y-2">
          {data?.timeOff.map((t) => (
            <li key={t.id} className="flex items-center justify-between rounded-2xl bg-sand-100/70 p-3 text-sm">
              <div><p className="font-semibold">{fmtDateTime(t.startAt)} → {fmtDateTime(t.endAt)}</p>{t.reason && <p className="text-xs text-ink-500">{t.reason}</p>}</div>
              <button onClick={async () => { await del(`/staff/${staffId}/time-off/${t.id}`); reload(); }} className="text-ink-300 hover:text-coral-600" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      </section>
      <Modal open={offOpen} onClose={() => setOffOpen(false)} title="Nuevo bloqueo">
        <div className="space-y-3">
          <Field label="Desde"><input type="datetime-local" className="input" value={off.startAt} onChange={(e) => setOff({ ...off, startAt: e.target.value.slice(0, 16) })} /></Field>
          <Field label="Hasta"><input type="datetime-local" className="input" value={off.endAt} onChange={(e) => setOff({ ...off, endAt: e.target.value.slice(0, 16) })} /></Field>
          <Field label="Motivo (opcional)"><input className="input" value={off.reason} onChange={(e) => setOff({ ...off, reason: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><button onClick={() => setOffOpen(false)} className="btn-ghost">Cancelar</button><button onClick={addOff} disabled={busy || !off.startAt || !off.endAt} className="btn-primary">Guardar</button></div>
        </div>
      </Modal>
    </div>
  );
}
