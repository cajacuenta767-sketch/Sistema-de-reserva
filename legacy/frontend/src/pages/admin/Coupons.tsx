import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { get, post, patch, del } from '@/api/client';
import type { Coupon } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { useToast } from '@/store/toast';
import { money } from '@/lib/format';
import { Field, Modal, PageLoader, Spinner, cx } from '@/components/ui';

const empty = { code: '', description: '', discountType: 'PERCENT' as 'PERCENT' | 'FIXED', value: 10, minAmountCents: 0, maxUses: '' as string | number, isActive: true };

export function AdminCoupons() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(() => get<{ items: Coupon[] }>('/coupons').then((r) => r.items));
  const [form, setForm] = useState<typeof empty | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!form) return; setBusy(true);
    try { await post('/coupons', { ...form, value: Number(form.value), minAmountCents: Number(form.minAmountCents), maxUses: form.maxUses === '' ? null : Number(form.maxUses) }); toast('Cupón creado', 'success'); setForm(null); reload(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const toggle = async (c: Coupon) => { await patch(`/coupons/${c.id}`, { isActive: !c.isActive }); reload(); };
  const remove = async (c: Coupon) => { if (confirm(`¿Eliminar ${c.code}?`)) { await del(`/coupons/${c.id}`); reload(); } };
  if (loading && !data) return <PageLoader />;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="section-title">Cupones</h1><button onClick={() => setForm({ ...empty })} className="btn-primary"><Plus className="h-4 w-4" /> Nuevo</button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.map((c) => (
          <div key={c.id} className={cx('card p-4', !c.isActive && 'opacity-60')}>
            <div className="flex items-start justify-between">
              <div><p className="font-mono text-lg font-bold text-brand-700">{c.code}</p><p className="text-sm text-ink-500">{c.description}</p></div>
              <button onClick={() => remove(c)} className="text-ink-300 hover:text-coral-600" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-sm">{c.discountType === 'PERCENT' ? `${c.value}% de descuento` : `${money(c.value)} de descuento`}{c.minAmountCents > 0 && ` · mínimo ${money(c.minAmountCents)}`}</p>
            <div className="mt-2 flex items-center justify-between text-xs text-ink-500">
              <span>Usos: {c.usedCount}{c.maxUses ? ` / ${c.maxUses}` : ''}</span>
              <button onClick={() => toggle(c)} className={cx('chip', c.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-sand-100')}>{c.isActive ? 'Activo' : 'Inactivo'}</button>
            </div>
          </div>
        ))}
      </div>
      <Modal open={!!form} onClose={() => setForm(null)} title="Nuevo cupón">
        {form && (
          <div className="space-y-3">
            <Field label="Código"><input className="input uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Descripción"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo"><select className="input" value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as 'PERCENT' | 'FIXED' })}><option value="PERCENT">Porcentaje</option><option value="FIXED">Monto fijo (centavos)</option></select></Field>
              <Field label="Valor"><input type="number" className="input" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} /></Field>
              <Field label="Mínimo (centavos)"><input type="number" className="input" value={form.minAmountCents} onChange={(e) => setForm({ ...form, minAmountCents: Number(e.target.value) })} /></Field>
              <Field label="Usos máximos"><input type="number" className="input" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="Ilimitado" /></Field>
            </div>
            <div className="flex justify-end gap-2"><button onClick={() => setForm(null)} className="btn-ghost">Cancelar</button><button onClick={save} disabled={busy} className="btn-primary">{busy ? <Spinner className="text-white" /> : 'Crear'}</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
