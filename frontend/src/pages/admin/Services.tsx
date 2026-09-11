import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { get, post, patch, del } from '@/api/client';
import type { Category, Service } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { useToast } from '@/store/toast';
import { money } from '@/lib/format';
import { Field, Modal, PageLoader, Spinner, cx, Picture } from '@/components/ui';

const empty = { name: '', description: '', durationMinutes: 60, bufferMinutes: 15, priceCents: 0, categoryId: '', imageUrl: '', isActive: true, isFeatured: false };
type Form = typeof empty;

export function AdminServices() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(async () => {
    const [s, c] = await Promise.all([get<{ items: Service[] }>('/services', { includeInactive: true }), get<{ items: Category[] }>('/categories')]);
    return { services: s.items, categories: c.items };
  });
  const [editing, setEditing] = useState<(Form & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState('');

  const save = async () => {
    if (!editing) return; setBusy(true);
    const body = { ...editing, categoryId: editing.categoryId || null, imageUrl: editing.imageUrl || null, priceCents: Number(editing.priceCents), durationMinutes: Number(editing.durationMinutes), bufferMinutes: Number(editing.bufferMinutes) };
    try {
      if (editing.id) await patch(`/services/${editing.id}`, body); else await post('/services', body);
      toast('Servicio guardado', 'success'); setEditing(null); reload();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const remove = async (s: Service) => {
    if (!confirm(`¿Eliminar "${s.name}"?`)) return;
    try { await del(`/services/${s.id}`); toast('Eliminado', 'success'); reload(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  const addCategory = async () => {
    if (!newCat.trim()) return;
    try { await post('/categories', { name: newCat.trim() }); setNewCat(''); reload(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  if (loading && !data) return <PageLoader />;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEditing((e) => (e ? { ...e, [k]: v } : e));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="section-title">Servicios</h1><button onClick={() => setEditing({ ...empty })} className="btn-primary"><Plus className="h-4 w-4" /> Nuevo</button></div>
      <div className="card flex flex-wrap items-center gap-2 p-4">
        <span className="text-sm font-semibold">Categorías:</span>
        {data?.categories.map((c) => <span key={c.id} className="chip bg-sand-100 text-ink-700">{c.name}</span>)}
        <input className="input !w-40 !py-1.5" placeholder="Nueva categoría" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
        <button onClick={addCategory} className="btn-secondary !py-1.5">Añadir</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.services.map((s) => (
          <div key={s.id} className={cx('card flex gap-4 p-4', !s.isActive && 'opacity-60')}>
            <div className="h-20 w-24 shrink-0 overflow-hidden rounded-2xl bg-sand-200"><Picture src={s.imageUrl} /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{s.name} {s.isFeatured && <span className="chip bg-amber-100 text-amber-800">Destacado</span>} {!s.isActive && <span className="chip bg-sand-100">Inactivo</span>}</p>
              <p className="text-xs text-ink-500">{s.durationMinutes} min · buffer {s.bufferMinutes} min · <b className="text-brand-700">{money(s.priceCents, s.currency)}</b></p>
              <p className="mt-1 line-clamp-2 text-xs text-ink-500">{s.description}</p>
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={() => setEditing({ id: s.id, name: s.name, description: s.description, durationMinutes: s.durationMinutes, bufferMinutes: s.bufferMinutes, priceCents: s.priceCents, categoryId: s.categoryId ?? '', imageUrl: s.imageUrl ?? '', isActive: s.isActive, isFeatured: s.isFeatured })} className="btn-ghost !p-2" aria-label="Editar"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => remove(s)} className="btn-ghost !p-2 text-coral-600" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Editar servicio' : 'Nuevo servicio'}>
        {editing && (
          <div className="space-y-3">
            <Field label="Nombre"><input className="input" value={editing.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Descripción"><textarea className="input min-h-20" value={editing.description} onChange={(e) => set('description', e.target.value)} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Duración (min)"><input type="number" className="input" value={editing.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))} /></Field>
              <Field label="Buffer (min)"><input type="number" className="input" value={editing.bufferMinutes} onChange={(e) => set('bufferMinutes', Number(e.target.value))} /></Field>
              <Field label="Precio (centavos)"><input type="number" className="input" value={editing.priceCents} onChange={(e) => set('priceCents', Number(e.target.value))} /></Field>
            </div>
            <Field label="Categoría">
              <select className="input" value={editing.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Sin categoría</option>{data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </Field>
            <Field label="URL de imagen"><input className="input" value={editing.imageUrl} onChange={(e) => set('imageUrl', e.target.value)} placeholder="https://…" /></Field>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={editing.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Activo</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-brand-600" checked={editing.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} /> Destacado</label>
            </div>
            <div className="flex justify-end gap-2"><button onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button><button onClick={save} disabled={busy} className="btn-primary">{busy ? <Spinner className="text-white" /> : 'Guardar'}</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
