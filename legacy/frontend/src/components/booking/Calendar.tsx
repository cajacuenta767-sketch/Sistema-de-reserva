import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, endOfMonth, format, getDay, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { cx } from '@/components/ui';
import { toLocalDate } from '@/lib/format';

interface Props {
  month: Date;
  onMonthChange: (d: Date) => void;
  availability: Record<string, number>; // date → nº de franjas
  selected: string | null;
  onSelect: (date: string) => void;
  loading?: boolean;
}

const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

export function Calendar({ month, onMonthChange, availability, selected, onSelect, loading }: Props) {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const offset = (getDay(start) + 6) % 7; // lunes = 0
  const days: (string | null)[] = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= end.getDate(); d++) days.push(toLocalDate(new Date(month.getFullYear(), month.getMonth(), d)));
  const today = toLocalDate(new Date());
  const canGoBack = format(month, 'yyyy-MM') > format(new Date(), 'yyyy-MM');

  return (
    <div className="card p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => onMonthChange(addMonths(month, -1))} disabled={!canGoBack} className="rounded-full p-2 hover:bg-sand-100 disabled:opacity-30" aria-label="Mes anterior"><ChevronLeft className="h-5 w-5" /></button>
        <h3 className="font-display text-lg font-semibold capitalize">{format(month, 'MMMM yyyy', { locale: es })}</h3>
        <button onClick={() => onMonthChange(addMonths(month, 1))} className="rounded-full p-2 hover:bg-sand-100" aria-label="Mes siguiente"><ChevronRight className="h-5 w-5" /></button>
      </div>
      <div className="mb-2 grid grid-cols-7 text-center text-[11px] font-bold uppercase tracking-wider text-ink-300">
        {DOW.map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className={cx('grid grid-cols-7 gap-1.5 transition-opacity', loading && 'opacity-50')}>
        {days.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const slots = availability[date] ?? 0;
          const past = date < today;
          const available = slots > 0 && !past;
          const isSel = selected === date;
          return (
            <button
              key={date}
              type="button"
              disabled={!available}
              onClick={() => onSelect(date)}
              className={cx(
                'relative flex aspect-square flex-col items-center justify-center rounded-2xl text-sm font-semibold transition-all',
                isSel ? 'bg-brand-600 text-white shadow-lift scale-105' : available ? 'bg-white ring-1 ring-ink-900/10 hover:bg-brand-50 hover:ring-brand-300' : 'text-ink-300',
                date === today && !isSel && 'ring-2 ring-brand-400',
              )}
            >
              {Number(date.slice(8, 10))}
              {available && !isSel && <span className={cx('absolute bottom-1.5 h-1 w-1 rounded-full', slots > 5 ? 'bg-brand-500' : 'bg-amber-400')} />}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex gap-4 text-[11px] text-ink-500">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-brand-500" /> Buena disponibilidad</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" /> Pocos cupos</span>
      </div>
    </div>
  );
}
