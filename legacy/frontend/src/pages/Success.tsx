import { Link, useLocation, useParams } from 'react-router-dom';
import { CalendarPlus, CheckCircle2, Copy, Home } from 'lucide-react';
import { get } from '@/api/client';
import type { Booking } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { useToast } from '@/store/toast';
import { BookingCard } from '@/components/booking/BookingCard';
import { PageLoader } from '@/components/ui';

export function Success() {
  const { id } = useParams();
  const state = useLocation().state as { items?: Booking[] } | null;
  const toast = useToast();
  const { data, loading } = useAsync(async () => {
    if (state?.items?.length) return state.items;
    const b = await get<Booking>(`/bookings/${id}`);
    if (!b.seriesId) return [b];
    const all = await get<{ items: Booking[] }>('/bookings', { limit: 50 });
    return all.items.filter((x) => x.seriesId === b.seriesId);
  }, [id]);
  if (loading || !data) return <PageLoader />;
  const first = data[0];
  const copy = () => navigator.clipboard?.writeText(first.code).then(() => toast('Código copiado', 'success'));
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="card relative overflow-hidden p-8 text-center animate-pop">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-400 via-brand-600 to-coral-400" />
        <CheckCircle2 className="mx-auto h-16 w-16 text-brand-600" />
        <h1 className="mt-4 font-display text-3xl font-bold">¡Reserva confirmada!</h1>
        <p className="mt-2 text-ink-500">{data.length > 1 ? `Agendamos ${data.length} citas de tu serie.` : 'Te enviamos los detalles a tu correo.'} Tu código de confirmación es:</p>
        <button onClick={copy} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-sand-100 px-5 py-3 font-mono text-xl font-bold tracking-widest text-brand-800 hover:bg-sand-200">{first.code} <Copy className="h-4 w-4" /></button>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to="/mis-reservas" className="btn-primary"><CalendarPlus className="h-4 w-4" /> Ver mis reservas</Link>
          <Link to="/" className="btn-secondary"><Home className="h-4 w-4" /> Inicio</Link>
        </div>
      </div>
      <div className="space-y-3">{data.map((b) => <BookingCard key={b.id} booking={b} />)}</div>
    </div>
  );
}
