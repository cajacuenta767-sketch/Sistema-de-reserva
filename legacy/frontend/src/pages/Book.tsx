import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { addDays } from 'date-fns';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, LogIn, Repeat, Sparkles, Ticket, UserRound, Wallet } from 'lucide-react';
import { get, post, ApiError } from '@/api/client';
import type { Booking, Category, Frequency, MonthAvailability, Quote, Service, Slot, Staff } from '@/api/types';
import { useAuth } from '@/store/auth';
import { useToast } from '@/store/toast';
import { FREQUENCY_HINT, FREQUENCY_LABEL, capitalize, fmtDate, money, toLocalDate, toMonthKey } from '@/lib/format';
import { Avatar, Field, PageLoader, Spinner, Stars, cx, Picture } from '@/components/ui';
import { Calendar } from '@/components/booking/Calendar';
import { StaffCard } from '@/components/booking/StaffCard';

const STEPS = ['Servicio', 'Frecuencia', 'Profesional', 'Fecha y hora', 'Confirmar'];
const FREQS: Frequency[] = ['ONCE', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'];
const KEY = 'reservaflow.wizard';

interface WizardState {
  step: number;
  serviceId: string | null;
  frequency: Frequency;
  staffId: string | null;
  date: string | null;
  slot: Slot | null;
  couponCode: string;
  notes: string;
}
const initial: WizardState = { step: 0, serviceId: null, frequency: 'ONCE', staffId: null, date: null, slot: null, couponCode: '', notes: '' };

const load = (): WizardState => { try { const r = sessionStorage.getItem(KEY); return r ? { ...initial, ...JSON.parse(r) } : initial; } catch { return initial; } };

export function Book() {
  const [params] = useSearchParams();
  const [w, setW] = useState<WizardState>(() => {
    const s = load();
    const pre = params.get('servicio');
    return pre ? { ...s, serviceId: pre, step: Math.max(s.step, 1) } : s;
  });
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(w)); } catch { /* ignore */ } }, [w]);
  const patchW = (p: Partial<WizardState>) => setW((s) => ({ ...s, ...p }));

  const [services, setServices] = useState<Service[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    Promise.all([get<{ items: Service[] }>('/services'), get<{ items: Category[] }>('/categories')]).then(([s, c]) => { setServices(s.items); setCategories(c.items); });
  }, []);
  const service = services?.find((s) => s.id === w.serviceId) ?? null;

  const next = () => patchW({ step: Math.min(w.step + 1, STEPS.length - 1) });
  const back = () => patchW({ step: Math.max(w.step - 1, 0) });
  const canNext = [!!w.serviceId, true, !!w.staffId, !!w.slot, false][w.step];

  if (!services) return <PageLoader />;

  return (
    <div className="space-y-8">
      <Stepper step={w.step} onJump={(i) => i < w.step && patchW({ step: i })} />
      <div key={w.step} className="animate-fade-up">
        {w.step === 0 && <StepService services={services} categories={categories} selected={w.serviceId} onSelect={(id) => { patchW({ serviceId: id, staffId: null, date: null, slot: null }); }} />}
        {w.step === 1 && <StepFrequency value={w.frequency} onChange={(f) => patchW({ frequency: f })} />}
        {w.step === 2 && service && <StepStaff service={service} selected={w.staffId} onSelect={(id) => patchW({ staffId: id, date: null, slot: null })} />}
        {w.step === 3 && service && w.staffId && <StepDateTime service={service} staffId={w.staffId} date={w.date} slot={w.slot} onChange={(date, slot) => patchW({ date, slot })} />}
        {w.step === 4 && service && w.staffId && w.slot && <StepConfirm w={w} service={service} onChange={patchW} onDone={() => { sessionStorage.removeItem(KEY); }} />}
      </div>
      {w.step < 4 && (
        <div className="sticky bottom-4 z-30 flex items-center justify-between gap-3 rounded-3xl bg-white/90 p-3 shadow-lift ring-1 ring-ink-900/10 backdrop-blur">
          <button onClick={back} disabled={w.step === 0} className="btn-secondary"><ArrowLeft className="h-4 w-4" /> Anterior</button>
          <div className="hidden text-sm text-ink-500 sm:block">
            {service ? <><b className="text-ink-900">{service.name}</b> · {FREQUENCY_LABEL[w.frequency]}{w.slot && <> · {capitalize(fmtDate(w.slot.startAt, 'EEE d MMM'))} {w.slot.time}</>}</> : 'Elige un servicio para empezar'}
          </div>
          <button onClick={next} disabled={!canNext} className="btn-primary">Siguiente <ArrowRight className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}

function Stepper({ step, onJump }: { step: number; onJump: (i: number) => void }) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto scrollbar-thin pb-1">
      {STEPS.map((label, i) => {
        const done = i < step; const active = i === step;
        return (
          <li key={label} className="flex shrink-0 items-center gap-2">
            <button onClick={() => onJump(i)} disabled={!done} className={cx('flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-sm font-semibold transition', active ? 'bg-brand-600 text-white shadow-lift' : done ? 'bg-brand-100 text-brand-800 hover:bg-brand-200' : 'bg-sand-100 text-ink-300')}>
              <span className={cx('flex h-7 w-7 items-center justify-center rounded-full text-xs', active ? 'bg-white/20' : done ? 'bg-brand-600 text-white' : 'bg-white text-ink-300')}>{done ? <Check className="h-4 w-4" /> : i + 1}</span>
              {label}
            </button>
            {i < STEPS.length - 1 && <span className={cx('h-0.5 w-6 rounded-full', done ? 'bg-brand-400' : 'bg-sand-200')} />}
          </li>
        );
      })}
    </ol>
  );
}

function StepService({ services, categories, selected, onSelect }: { services: Service[]; categories: Category[]; selected: string | null; onSelect: (id: string) => void }) {
  const [cat, setCat] = useState<string | null>(null);
  const list = cat ? services.filter((s) => s.categoryId === cat) : services;
  return (
    <section className="space-y-5">
      <header>
        <h2 className="section-title">¿Qué servicio necesitas?</h2>
        <p className="text-ink-500">Elige uno para ver profesionales y horarios disponibles.</p>
      </header>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setCat(null)} className={cx('chip px-4 py-2', !cat ? 'bg-ink-900 text-white' : 'bg-white ring-1 ring-ink-900/10 hover:bg-sand-100')}>Todos</button>
        {categories.map((c) => <button key={c.id} onClick={() => setCat(c.id)} className={cx('chip px-4 py-2', cat === c.id ? 'bg-ink-900 text-white' : 'bg-white ring-1 ring-ink-900/10 hover:bg-sand-100')}>{c.name}</button>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s) => (
          <button key={s.id} type="button" onClick={() => onSelect(s.id)} className={cx('card group overflow-hidden text-left transition-all hover:-translate-y-1 hover:shadow-lift', selected === s.id && 'ring-2 ring-brand-500 shadow-lift')}>
            <div className="relative aspect-[16/9] overflow-hidden bg-sand-200">
              <Picture src={s.imageUrl} className="transition duration-500 group-hover:scale-105" />
              {selected === s.id && <span className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white"><Check className="h-4 w-4" /></span>}
              {s.isFeatured && <span className="absolute left-3 top-3 chip bg-white/90 text-brand-800"><Sparkles className="h-3 w-3" /> Popular</span>}
            </div>
            <div className="space-y-1.5 p-4">
              <h3 className="font-semibold">{s.name}</h3>
              <p className="line-clamp-2 text-xs text-ink-500">{s.description}</p>
              <div className="flex items-center justify-between pt-1 text-sm">
                <span className="flex items-center gap-1 text-ink-500"><Clock3 className="h-4 w-4" /> {s.durationMinutes} min</span>
                <span className="font-bold text-brand-700">{money(s.priceCents, s.currency)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function StepFrequency({ value, onChange }: { value: Frequency; onChange: (f: Frequency) => void }) {
  return (
    <section className="space-y-5">
      <header>
        <h2 className="section-title">¿Con qué frecuencia lo necesitas?</h2>
        <p className="text-ink-500">Para servicios recurrentes reservamos toda la serie en el mismo horario.</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FREQS.map((f) => (
          <button key={f} type="button" onClick={() => onChange(f)} className={cx('card flex flex-col items-start gap-2 p-5 text-left transition-all hover:-translate-y-1 hover:shadow-lift', value === f && 'bg-brand-600 text-white ring-2 ring-brand-500')}>
            <span className={cx('flex h-10 w-10 items-center justify-center rounded-2xl', value === f ? 'bg-white/20' : 'bg-brand-50 text-brand-700')}><Repeat className="h-5 w-5" /></span>
            <span className="text-lg font-semibold">{FREQUENCY_LABEL[f]}</span>
            <span className={cx('text-xs', value === f ? 'text-white/80' : 'text-ink-500')}>{FREQUENCY_HINT[f]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function StepStaff({ service, selected, onSelect }: { service: Service; selected: string | null; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | 'today' | 'tomorrow'>('all');
  const [items, setItems] = useState<Staff[] | null>(null);
  useEffect(() => {
    setItems(null);
    const availableOn = filter === 'today' ? toLocalDate(new Date()) : filter === 'tomorrow' ? toLocalDate(addDays(new Date(), 1)) : undefined;
    get<{ items: Staff[] }>('/staff', { serviceId: service.id, availableOn }).then((r) => setItems(r.items));
  }, [service.id, filter]);
  const tabs = [{ k: 'all', l: 'Todos' }, { k: 'today', l: 'Disponible hoy' }, { k: 'tomorrow', l: 'Disponible mañana' }] as const;
  return (
    <section className="space-y-5">
      <header>
        <h2 className="section-title">Elige a tu profesional</h2>
        <p className="text-ink-500">Profesionales que ofrecen <b>{service.name}</b>.</p>
      </header>
      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-sand-100 p-1">
        {tabs.map((t) => <button key={t.k} onClick={() => setFilter(t.k)} className={cx('rounded-xl px-3 py-2 text-sm font-semibold transition', filter === t.k ? 'bg-white shadow-soft text-ink-900' : 'text-ink-500 hover:text-ink-900')}>{t.l}</button>)}
      </div>
      {!items ? <PageLoader text="Buscando profesionales…" /> : items.length === 0 ? (
        <div className="card p-10 text-center text-ink-500">Nadie está disponible con ese filtro. Prueba con “Todos” y elige otra fecha.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => <StaffCard key={s.id} staff={s} selected={selected === s.id} onSelect={() => onSelect(s.id)} />)}
        </div>
      )}
    </section>
  );
}

function StepDateTime({ service, staffId, date, slot, onChange }: { service: Service; staffId: string; date: string | null; slot: Slot | null; onChange: (date: string | null, slot: Slot | null) => void }) {
  const [month, setMonth] = useState(() => (date ? new Date(date + 'T00:00') : new Date()));
  const [avail, setAvail] = useState<Record<string, number>>({});
  const [loadingMonth, setLoadingMonth] = useState(true);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const mk = toMonthKey(month);

  useEffect(() => {
    setLoadingMonth(true);
    get<MonthAvailability>(`/staff/${staffId}/availability/month`, { serviceId: service.id, month: mk })
      .then((r) => setAvail((a) => ({ ...a, ...Object.fromEntries(r.days.map((d) => [d.date, d.slots])) })))
      .finally(() => setLoadingMonth(false));
  }, [staffId, service.id, mk]);

  useEffect(() => {
    if (!date) { setSlots(null); return; }
    setSlots(null);
    get<{ slots: Slot[] }>(`/staff/${staffId}/availability`, { serviceId: service.id, date }).then((r) => setSlots(r.slots));
  }, [staffId, service.id, date]);

  const grouped = useMemo(() => {
    const g: Record<string, Slot[]> = { Mañana: [], Tarde: [], Noche: [] };
    for (const s of slots ?? []) { const h = Number(s.time.slice(0, 2)); (h < 12 ? g['Mañana'] : h < 18 ? g['Tarde'] : g['Noche']).push(s); }
    return g;
  }, [slots]);

  return (
    <section className="space-y-5">
      <header>
        <h2 className="section-title">Elige fecha y hora</h2>
        <p className="text-ink-500">Duración: {service.durationMinutes} min. Los días marcados tienen cupos.</p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Calendar month={month} onMonthChange={setMonth} availability={avail} selected={date} onSelect={(d) => onChange(d, null)} loading={loadingMonth} />
        <div className="card p-5 sm:p-6">
          {!date ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-ink-500"><CalendarDays className="h-8 w-8 text-brand-300" /> Selecciona un día en el calendario</div>
          ) : !slots ? <PageLoader text="Buscando horarios…" /> : (
            <div className="space-y-5">
              <p className="flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4 text-brand-600" /> {capitalize(fmtDate(date, "EEEE d 'de' MMMM"))}</p>
              {slots.length === 0 && <p className="text-sm text-ink-500">No quedan cupos ese día.</p>}
              {Object.entries(grouped).filter(([, v]) => v.length).map(([label, list]) => (
                <div key={label}>
                  <p className="label">{label}</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {list.map((s) => (
                      <button key={s.startAt} onClick={() => onChange(date, s)} className={cx('rounded-xl py-2.5 text-sm font-semibold transition', slot?.startAt === s.startAt ? 'bg-brand-600 text-white shadow-lift' : 'bg-sand-100 hover:bg-brand-50 hover:text-brand-800')}>{s.time}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StepConfirm({ w, service, onChange, onDone }: { w: WizardState; service: Service; onChange: (p: Partial<WizardState>) => void; onDone: () => void }) {
  const { user, refreshMe } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [couponInput, setCouponInput] = useState(w.couponCode);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [contact, setContact] = useState({ firstName: '', lastName: '', phone: '', address: '', city: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (w.staffId) get<Staff>(`/staff/${w.staffId}`).then(setStaff); }, [w.staffId]);
  useEffect(() => { if (user) setContact({ firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? '', address: user.address ?? '', city: user.city ?? '' }); }, [user]);
  useEffect(() => {
    setCouponError(null);
    post<Quote>('/bookings/quote', { serviceId: service.id, couponCode: w.couponCode || null, frequency: w.frequency })
      .then(setQuote)
      .catch((e: ApiError) => { setCouponError(e.message); onChange({ couponCode: '' }); });
  }, [service.id, w.couponCode, w.frequency]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    if (!user || !w.slot) return;
    setBusy(true);
    try {
      const r = await post<{ items: Booking[] }>('/bookings', {
        staffId: w.staffId, serviceId: service.id, startAt: w.slot.startAt, frequency: w.frequency,
        couponCode: w.couponCode || null, notes: w.notes || null, address: contact.address || null,
        contact: { firstName: contact.firstName, lastName: contact.lastName, phone: contact.phone || null, address: contact.address || null, city: contact.city || null },
      });
      await refreshMe();
      onDone();
      navigate(`/reserva-confirmada/${r.items[0].id}`, { state: { items: r.items } });
    } catch (e) {
      const err = e as ApiError;
      const unavailable = (err.details as { unavailable?: string[] } | undefined)?.unavailable;
      toast(unavailable?.length ? `${err.message}: ${unavailable.map((d) => d.replace('T', ' ')).join(', ')}` : err.message, 'error');
      if (err.status === 409) onChange({ step: 3, slot: null });
    } finally { setBusy(false); }
  };

  const setC = (k: keyof typeof contact) => (e: React.ChangeEvent<HTMLInputElement>) => setContact((c) => ({ ...c, [k]: e.target.value }));

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <header>
          <h2 className="section-title">Tus datos</h2>
          <p className="text-ink-500">{user ? <>Reservando como <b>{user.email}</b>.</> : 'Necesitas una cuenta para confirmar la reserva.'}</p>
        </header>
        {!user ? (
          <div className="card flex flex-col items-center gap-4 p-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><LogIn className="h-7 w-7" /></span>
            <p className="text-ink-500">Inicia sesión o crea una cuenta en segundos. Tu selección se conservará.</p>
            <div className="flex gap-2">
              <Link to="/login" state={{ from: '/reservar' }} className="btn-primary">Entrar</Link>
              <Link to="/registro" state={{ from: '/reservar' }} className="btn-secondary">Crear cuenta</Link>
            </div>
          </div>
        ) : (
          <div className="card space-y-4 p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre"><input className="input" value={contact.firstName} onChange={setC('firstName')} required /></Field>
              <Field label="Apellido"><input className="input" value={contact.lastName} onChange={setC('lastName')} required /></Field>
              <Field label="Teléfono"><input className="input" value={contact.phone} onChange={setC('phone')} placeholder="+57 300 000 0000" /></Field>
              <Field label="Ciudad"><input className="input" value={contact.city} onChange={setC('city')} /></Field>
            </div>
            <Field label="Dirección del servicio"><input className="input" value={contact.address} onChange={setC('address')} placeholder="Calle 80 # 63-21, apto 302" /></Field>
            <Field label="Notas para el profesional (opcional)"><textarea className="input min-h-24" value={w.notes} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Ej: el portón es negro, timbre 2." /></Field>
          </div>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Resumen</p>
            <h3 className="font-display text-2xl font-semibold">{service.name}</h3>
          </div>
          <div className="space-y-3 p-5 text-sm">
            {staff && <p className="flex items-center gap-3"><Avatar src={staff.avatarUrl} name={staff.displayName} size="sm" /><span><b>{staff.displayName}</b><br /><Stars value={staff.ratingAvg} size="sm" /></span></p>}
            {w.slot && <p className="flex items-center gap-3"><CalendarDays className="h-4 w-4 text-brand-600" /> {capitalize(fmtDate(w.slot.startAt, "EEEE d 'de' MMMM"))} · <b>{w.slot.time}</b></p>}
            <p className="flex items-center gap-3"><Clock3 className="h-4 w-4 text-brand-600" /> {service.durationMinutes} minutos</p>
            <p className="flex items-center gap-3"><Repeat className="h-4 w-4 text-brand-600" /> {FREQUENCY_LABEL[w.frequency]} · {FREQUENCY_HINT[w.frequency]}</p>
            <div className="border-t border-ink-900/5 pt-3">
              <p className="label">Cupón de descuento</p>
              <div className="flex gap-2">
                <input className="input uppercase" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} placeholder="BIENVENIDO10" />
                <button onClick={() => onChange({ couponCode: couponInput.trim().toUpperCase() })} className="btn-secondary"><Ticket className="h-4 w-4" /></button>
              </div>
              {couponError && <p className="mt-1 text-xs text-coral-600">{couponError}</p>}
              {quote?.coupon && <p className="mt-1 text-xs text-emerald-700">✓ {quote.coupon.description}</p>}
            </div>
            {quote && (
              <div className="space-y-1 border-t border-ink-900/5 pt-3">
                <p className="flex justify-between text-ink-500"><span>Precio por cita</span><span>{money(quote.priceCents, quote.currency)}</span></p>
                {quote.discountCents > 0 && <p className="flex justify-between text-emerald-700"><span>Descuento</span><span>− {money(quote.discountCents, quote.currency)}</span></p>}
                {quote.occurrences > 1 && <p className="flex justify-between text-ink-500"><span>Citas</span><span>× {quote.occurrences}</span></p>}
                <p className="flex items-center justify-between pt-1 text-lg font-bold"><span className="flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-600" /> Total</span><span className="text-brand-700">{money(quote.grandTotalCents, quote.currency)}</span></p>
                <p className="text-[11px] text-ink-300">Pago al finalizar el servicio.</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onChange({ step: 3 })} className="btn-secondary"><ArrowLeft className="h-4 w-4" /> Anterior</button>
          <button onClick={confirm} disabled={!user || busy || !quote} className="btn-primary flex-1">{busy ? <Spinner className="text-white" /> : <><UserRound className="h-4 w-4" /> Confirmar reserva</>}</button>
        </div>
      </aside>
    </section>
  );
}
