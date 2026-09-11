import { BriefcaseBusiness, Check, Mail, Phone } from 'lucide-react';
import type { Staff } from '@/api/types';
import { Avatar, Stars, cx } from '@/components/ui';

export function StaffCard({ staff: s, selected, onSelect }: { staff: Staff; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cx('card group relative w-full overflow-hidden text-left transition-all hover:-translate-y-1 hover:shadow-lift', selected && 'ring-2 ring-brand-500 shadow-lift')}
    >
      {selected && <span className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white shadow"><Check className="h-4 w-4" /></span>}
      <div className="h-24 bg-gradient-to-br from-brand-100 via-brand-50 to-coral-100" />
      <div className="-mt-10 px-5 pb-5">
        <Avatar src={s.avatarUrl} name={s.displayName} size="xl" className="ring-4" />
        <h3 className="mt-3 text-lg font-semibold">{s.displayName}</h3>
        <p className="text-sm text-ink-500">{s.title}</p>
        <div className="mt-2"><Stars value={s.ratingAvg} size="sm" count={s.ratingCount} /></div>
        <p className="mt-2 line-clamp-2 text-xs text-ink-500">{s.bio}</p>
        <ul className="mt-3 space-y-1 text-xs text-ink-700">
          <li className="flex items-center gap-2"><BriefcaseBusiness className="h-3.5 w-3.5 text-brand-600" /> Trabajos completados: <b>{s.completedJobs}</b></li>
          <li className="flex items-center gap-2 truncate"><Mail className="h-3.5 w-3.5 text-brand-600" /> {s.email}</li>
          {s.phone && <li className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-brand-600" /> {s.phone}</li>}
        </ul>
      </div>
    </button>
  );
}
