import { useState } from 'react';
import { ArrowLeft, ArrowRight, Quote } from 'lucide-react';
import type { Review } from '@/api/types';
import { Stars, cx } from '@/components/ui';

export function Testimonials({ reviews }: { reviews: Review[] }) {
  const [i, setI] = useState(0);
  const r = reviews[i];
  return (
    <section>
      <h2 className="section-title mb-6">Nuestros clientes satisfechos</h2>
      <div className="relative">
        <div className="card relative overflow-hidden p-8 sm:p-10">
          <Quote className="absolute right-6 top-6 h-14 w-14 text-brand-100" />
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-base font-bold text-brand-800">{r.clientName[0]}</div>
            <div>
              <p className="font-semibold">{r.clientName}</p>
              <Stars value={r.rating} size="sm" />
            </div>
          </div>
          <p className="font-display text-xl italic leading-relaxed text-ink-700 sm:text-2xl">“{r.comment}”</p>
          <p className="mt-4 text-xs text-ink-500">{r.serviceName} · con {r.staffName}</p>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-2">
            {reviews.map((_, idx) => (
              <button key={idx} onClick={() => setI(idx)} className={cx('h-2.5 rounded-full transition-all', idx === i ? 'w-6 bg-brand-600' : 'w-2.5 bg-sand-300')} aria-label={`Testimonio ${idx + 1}`} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setI((i - 1 + reviews.length) % reviews.length)} className="btn-secondary !rounded-full !p-3" aria-label="Anterior"><ArrowLeft className="h-4 w-4" /></button>
            <button onClick={() => setI((i + 1) % reviews.length)} className="btn-primary !rounded-full !p-3" aria-label="Siguiente"><ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </section>
  );
}
