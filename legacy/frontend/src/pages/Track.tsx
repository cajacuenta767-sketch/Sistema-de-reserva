import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { get } from '@/api/client';
import type { Booking } from '@/api/types';
import { BookingCard } from '@/components/booking/BookingCard';
import { Spinner } from '@/components/ui';

export function Track() {
  const [code, setCode] = useState('');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setBooking(null);
    try { setBooking(await get<Booking>(`/bookings/code/${encodeURIComponent(code.trim().toUpperCase())}`)); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-xl space-y-6 animate-fade-up">
      <div className="text-center">
        <h1 className="section-title">Seguir una reserva</h1>
        <p className="mt-1 text-ink-500">Ingresa el código de confirmación que recibiste (ej. RF-7K3Q9P).</p>
      </div>
      <form onSubmit={submit} className="card flex gap-2 p-3">
        <input className="input font-mono uppercase" placeholder="RF-XXXXXX" value={code} onChange={(e) => setCode(e.target.value)} required />
        <button className="btn-primary" disabled={busy}>{busy ? <Spinner className="text-white" /> : <Search className="h-4 w-4" />}</button>
      </form>
      {error && <p className="text-center text-sm text-coral-600">{error}</p>}
      {booking && <BookingCard booking={booking} />}
    </div>
  );
}
