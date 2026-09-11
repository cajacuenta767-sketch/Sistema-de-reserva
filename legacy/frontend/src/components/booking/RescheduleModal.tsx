import { useEffect, useState } from 'react';
import { get, post } from '@/api/client';
import type { Booking, MonthAvailability, Slot } from '@/api/types';
import { useToast } from '@/store/toast';
import { toMonthKey } from '@/lib/format';
import { Modal, PageLoader, Spinner, cx } from '@/components/ui';
import { Calendar } from './Calendar';

export function RescheduleModal({ booking, onClose, onDone }: { booking: Booking | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [month, setMonth] = useState(new Date());
  const [avail, setAvail] = useState<Record<string, number>>({});
  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const mk = toMonthKey(month);

  useEffect(() => { setDate(null); setSlot(null); setAvail({}); }, [booking?.id]);
  useEffect(() => {
    if (!booking) return;
    get<MonthAvailability>(`/staff/${booking.staffId}/availability/month`, { serviceId: booking.serviceId, month: mk })
      .then((r) => setAvail((a) => ({ ...a, ...Object.fromEntries(r.days.map((d) => [d.date, d.slots])) })));
  }, [booking, mk]);
  useEffect(() => {
    if (!booking || !date) return;
    setSlots(null);
    get<{ slots: Slot[] }>(`/staff/${booking.staffId}/availability`, { serviceId: booking.serviceId, date }).then((r) => setSlots(r.slots));
  }, [booking, date]);

  const submit = async () => {
    if (!booking || !slot) return;
    setBusy(true);
    try { await post(`/bookings/${booking.id}/reschedule`, { startAt: slot.startAt }); toast('Reserva reprogramada', 'success'); onDone(); onClose(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal open={!!booking} onClose={onClose} title="Reprogramar cita" wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Calendar month={month} onMonthChange={setMonth} availability={avail} selected={date} onSelect={(d) => { setDate(d); setSlot(null); }} />
        <div className="card p-4">
          {!date ? <p className="py-10 text-center text-sm text-ink-500">Elige un día</p> : !slots ? <PageLoader /> : (
            <div className="grid grid-cols-3 gap-2">
              {slots.map((s) => <button key={s.startAt} onClick={() => setSlot(s)} className={cx('rounded-xl py-2 text-sm font-semibold', slot?.startAt === s.startAt ? 'bg-brand-600 text-white' : 'bg-sand-100 hover:bg-brand-50')}>{s.time}</button>)}
              {slots.length === 0 && <p className="col-span-3 text-center text-sm text-ink-500">Sin cupos</p>}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="btn-ghost">Cancelar</button>
        <button onClick={submit} disabled={!slot || busy} className="btn-primary">{busy ? <Spinner className="text-white" /> : 'Confirmar cambio'}</button>
      </div>
    </Modal>
  );
}
