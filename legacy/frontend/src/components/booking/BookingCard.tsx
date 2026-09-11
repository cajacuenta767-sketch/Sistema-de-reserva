import { CalendarDays, Clock3, MapPin, Repeat, Ticket, UserRound } from 'lucide-react';
import type { Booking } from '@/api/types';
import { FREQUENCY_LABEL, STATUS_LABEL, STATUS_STYLE, capitalize, fmtDate, fmtTime, money } from '@/lib/format';
import { Avatar, Badge } from '@/components/ui';
import type { ReactNode } from 'react';

export function BookingCard({ booking: b, actions, showClient }: { booking: Booking; actions?: ReactNode; showClient?: boolean }) {
  return (
    <article className="card overflow-hidden animate-fade-up">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl bg-brand-50 px-4 py-3 text-brand-800 sm:w-24">
          <span className="text-xs font-semibold uppercase">{fmtDate(b.startAt, 'MMM')}</span>
          <span className="font-display text-3xl font-bold leading-none">{fmtDate(b.startAt, 'd')}</span>
          <span className="text-xs">{fmtDate(b.startAt, 'EEE')}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{b.service?.name ?? 'Servicio'}</h3>
            <Badge className={STATUS_STYLE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
            {b.frequency !== 'ONCE' && <Badge className="bg-sand-100 text-ink-700"><Repeat className="h-3 w-3" /> {FREQUENCY_LABEL[b.frequency]} · {b.seriesIndex + 1}</Badge>}
          </div>
          <div className="grid gap-1 text-sm text-ink-500 sm:grid-cols-2">
            <span className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-brand-600" /> {fmtTime(b.startAt)} – {fmtTime(b.endAt)}</span>
            <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-brand-600" /> {capitalize(fmtDate(b.startAt, "d 'de' MMMM yyyy"))}</span>
            {b.staff && <span className="flex items-center gap-2"><Avatar src={b.staff.avatarUrl} name={b.staff.displayName} size="sm" /> {b.staff.displayName}</span>}
            {showClient && b.client && <span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-brand-600" /> {b.client.firstName} {b.client.lastName} {b.client.phone && <span className="text-ink-300">· {b.client.phone}</span>}</span>}
            {b.address && <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-brand-600" /> {b.address}</span>}
            {b.couponCode && <span className="flex items-center gap-2"><Ticket className="h-4 w-4 text-brand-600" /> Cupón {b.couponCode}</span>}
          </div>
          {b.notes && <p className="rounded-xl bg-sand-100 px-3 py-2 text-xs text-ink-700">“{b.notes}”</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span className="font-mono text-xs text-ink-300">{b.code}</span>
          <span className="font-display text-xl font-bold text-brand-700">{money(b.totalCents, b.service?.currency)}</span>
          {b.discountCents > 0 && <span className="text-xs text-ink-300 line-through">{money(b.priceCents, b.service?.currency)}</span>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap justify-end gap-2 border-t border-ink-900/5 bg-sand-50/60 px-5 py-3">{actions}</div>}
    </article>
  );
}
