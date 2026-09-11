import { get } from '@/api/client';
import type { Stats } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { STATUS_LABEL, money, fmtDate } from '@/lib/format';
import { PageLoader, StatTile, Stars } from '@/components/ui';

export function Dashboard() {
  const { data, loading } = useAsync(() => get<Stats>('/admin/stats'));
  if (loading || !data) return <PageLoader />;
  const max = Math.max(1, ...data.last14Days.map((d) => d.bookings));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="section-title">Resumen del negocio</h1>
        <p className="text-ink-500">Ventana: {data.range.from} → {data.range.to}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Reservas (ventana)" value={data.range.total} accent="brand" />
        <StatTile label="Ingresos proyectados" value={money(data.range.revenueCents)} sub="Confirmadas + completadas" accent="sky" />
        <StatTile label="Citas de hoy" value={data.today.total} sub={`${data.today.byStatus.COMPLETED} completadas`} accent="amber" />
        <StatTile label="Valoración media" value={data.reviews.avgRating || '—'} sub={`${data.reviews.count} reseñas`} accent="coral" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="card p-5">
          <h2 className="mb-4 font-semibold">Reservas · últimos 14 días</h2>
          <div className="flex h-44 items-end gap-1.5">
            {data.last14Days.map((d) => (
              <div key={d.date} className="group relative flex flex-1 flex-col items-center justify-end">
                <div className="w-full rounded-t-lg bg-gradient-to-t from-brand-600 to-brand-400 transition-all group-hover:from-brand-700" style={{ height: `${(d.bookings / max) * 100}%`, minHeight: d.bookings ? 6 : 2 }} />
                <span className="absolute -top-7 hidden rounded-lg bg-ink-900 px-2 py-1 text-[10px] text-white group-hover:block">{d.bookings} · {money(d.revenueCents)}</span>
                <span className="mt-1 text-[10px] text-ink-300">{fmtDate(d.date, 'd')}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card p-5">
          <h2 className="mb-4 font-semibold">Por estado</h2>
          <ul className="space-y-2">
            {(Object.keys(data.range.byStatus) as (keyof typeof data.range.byStatus)[]).map((k) => {
              const v = data.range.byStatus[k];
              const pct = data.range.total ? (v / data.range.total) * 100 : 0;
              return (
                <li key={k} className="text-sm">
                  <div className="flex justify-between"><span>{STATUS_LABEL[k]}</span><b>{v}</b></div>
                  <div className="mt-1 h-2 rounded-full bg-sand-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <section className="card overflow-x-auto p-5">
        <h2 className="mb-4 font-semibold">Equipo</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-ink-500"><tr><th className="pb-2">Profesional</th><th className="pb-2">Valoración</th><th className="pb-2">Trabajos</th><th className="pb-2">Estado</th></tr></thead>
          <tbody>
            {data.staff.map((s) => (
              <tr key={s.id} className="border-t border-ink-900/5"><td className="py-2 font-semibold">{s.name}</td><td><Stars value={s.rating} size="sm" /></td><td>{s.completedJobs}</td><td><span className={`chip ${s.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-sand-100 text-ink-500'}`}>{s.isActive ? 'Activo' : 'Inactivo'}</span></td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
