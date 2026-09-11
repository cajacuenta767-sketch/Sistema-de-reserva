import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, Clock3, ShieldCheck, Sparkles, Star, Users } from 'lucide-react';
import { get } from '@/api/client';
import type { Review, Service, Staff } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { money } from '@/lib/format';
import { Avatar, Stars, Picture } from '@/components/ui';
import { Testimonials } from '@/components/booking/Testimonials';

export function Home() {
  const { data } = useAsync(async () => {
    const [services, staff, reviews] = await Promise.all([
      get<{ items: Service[] }>('/services'),
      get<{ items: Staff[] }>('/staff'),
      get<{ items: Review[] }>('/reviews', { limit: 8, minRating: 4 }),
    ]);
    return { services: services.items, staff: staff.items, reviews: reviews.items };
  });
  const featured = data?.services.filter((s) => s.isFeatured).slice(0, 3) ?? data?.services.slice(0, 3) ?? [];

  return (
    <div className="space-y-20">
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-2">
        <div className="space-y-6 animate-fade-up">
          <span className="chip bg-brand-100 text-brand-800"><Sparkles className="h-3.5 w-3.5" /> Reserva en menos de 2 minutos</span>
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Servicios a domicilio,<br /><span className="bg-gradient-to-r from-brand-600 to-brand-400 bg-clip-text text-transparent">agendados a tu ritmo.</span>
          </h1>
          <p className="max-w-lg text-lg text-ink-500">Elige el servicio, tu profesional favorito y la hora que mejor te quede. Recibe confirmación al instante y gestiona todo desde un solo lugar.</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/reservar" className="btn-primary text-base">Reservar ahora <ArrowRight className="h-4 w-4" /></Link>
            <Link to="/seguimiento" className="btn-secondary text-base">Seguir una reserva</Link>
          </div>
          <div className="flex flex-wrap gap-6 pt-2 text-sm text-ink-500">
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-600" /> Profesionales verificados</span>
            <span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-brand-600" /> Cancela con 2h de antelación</span>
            <span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-brand-600" /> Citas recurrentes</span>
          </div>
        </div>
        <div className="relative animate-pop">
          <div className="absolute -inset-4 rounded-[2.5rem] bg-gradient-to-br from-brand-200/60 via-transparent to-coral-100/60 blur-2xl" />
          <div className="card relative space-y-4 p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink-500">Próxima cita disponible</span>
              <span className="chip bg-emerald-100 text-emerald-800">Hoy</span>
            </div>
            {(data?.staff ?? []).slice(0, 3).map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 rounded-2xl bg-sand-100/70 p-3" style={{ animationDelay: `${i * 80}ms` }}>
                <Avatar src={s.avatarUrl} name={s.displayName} />
                <div className="flex-1">
                  <p className="text-sm font-semibold">{s.displayName}</p>
                  <p className="text-xs text-ink-500">{s.title}</p>
                </div>
                <Stars value={s.ratingAvg} size="sm" />
              </div>
            ))}
            <Link to="/reservar" className="btn-primary w-full">Ver disponibilidad</Link>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h2 className="section-title">Servicios destacados</h2>
            <p className="mt-1 text-ink-500">Lo que más reservan nuestros clientes.</p>
          </div>
          <Link to="/reservar" className="hidden text-sm font-semibold text-brand-700 hover:underline sm:block">Ver todos →</Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((s) => (
            <Link key={s.id} to={`/reservar?servicio=${s.id}`} className="card group overflow-hidden transition hover:-translate-y-1 hover:shadow-lift">
              <div className="aspect-[16/10] overflow-hidden bg-sand-200">
                <Picture src={s.imageUrl} alt={s.name} className="transition duration-500 group-hover:scale-105" />
              </div>
              <div className="space-y-2 p-5">
                <h3 className="font-semibold">{s.name}</h3>
                <p className="line-clamp-2 text-sm text-ink-500">{s.description}</p>
                <div className="flex items-center justify-between pt-1 text-sm">
                  <span className="flex items-center gap-1 text-ink-500"><Clock3 className="h-4 w-4" /> {s.durationMinutes} min</span>
                  <span className="font-bold text-brand-700">{money(s.priceCents, s.currency)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-6 rounded-[2rem] bg-ink-900 p-8 text-white sm:grid-cols-3 sm:p-12">
        {[
          { icon: <Users className="h-6 w-6" />, title: 'Elige a tu profesional', text: 'Perfiles con reseñas reales, trabajos completados y disponibilidad en vivo.' },
          { icon: <CalendarClock className="h-6 w-6" />, title: 'Frecuencia a tu medida', text: 'Una vez, semanal, quincenal o mensual. Nosotros reservamos toda la serie.' },
          { icon: <Star className="h-6 w-6" />, title: 'Califica y mejora', text: 'Tu opinión ayuda a otros clientes y premia a los mejores profesionales.' },
        ].map((f) => (
          <div key={f.title} className="space-y-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-brand-300">{f.icon}</span>
            <h3 className="text-lg font-semibold">{f.title}</h3>
            <p className="text-sm text-white/70">{f.text}</p>
          </div>
        ))}
      </section>

      {data && data.reviews.length > 0 && <Testimonials reviews={data.reviews} />}
    </div>
  );
}
