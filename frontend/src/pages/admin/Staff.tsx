import { useState } from 'react';
import { CalendarCog, Plus, Pencil } from 'lucide-react';
import { get, post, patch } from '@/api/client';
import type { Service, Staff } from '@/api/types';
import { useAsync } from '@/lib/useAsync';
import { useToast } from '@/store/toast';
import { Avatar, Field, Modal, PageLoader, Spinner, Stars, cx } from '@/components/ui';
import { ScheduleEditor } from '@/pages/staff/Agenda';

const empty = { email: '', password: '', firstName: '', lastName: '', title: '', bio: '', avatarUrl: '', phone: '', serviceIds: [] as string[] };

export function AdminStaff() {
  const toast = useToast();
  const { data, loading, reload } = useAsync(async () => {
    const [s, sv] = await Promise.all([get<{ items: Staff[] }>('/staff', { includeInactive: true }), get<{ items: Service[] }>('/services', { includeInactive: true })]);
    return { staff: s.items, services: sv.items };
  });
  const [creating, setCreating] = useState<typeof empty | null>(null);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [schedule, setSchedule] = useState<Staff | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!creating) return; setBusy(true);
    try { await post('/staff', { ...creating, avatarUrl: creating.avatarUrl || null, phone: creating.phone || null }); toast('Profesional creado', 'success'); setCreating(null); reload(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  const update = async () => {
    if (!editing) return; setBusy(true);
    try { await patch(`/staff/${editing.id}`, { displayName: editing.displayName, title: editing.title, bio: editing.bio, avatarUrl: editing.avatarUrl || null, phone: editing.phone || null, isActive: editing.isActive, serviceIds: editing.serviceIds }); toast('Guardado', 'success'); setEditing(null); reload(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  if (loading && !data) return <PageLoader />;

  const ServicePicker = ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <div className="flex flex-wrap gap-2">
      {data?.services.map((s) => <button key={s.id} type="button" onClick={() => onChange(value.includes(s.id) ? value.filter((x) => x !== s.id) : [...value, s.id])} className={cx('chip px-3 py-1.5', value.includes(s.id) ? 'bg-brand-600 text-white' : 'bg-sand-100 text-ink-700')}>{s.name}</button>)}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between"><h1 className="section-title">Personal</h1><button onClick={() => setCreating({ ...empty })} className="btn-primary"><Plus className="h-4 w-4" /> Nuevo</button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.staff.map((s) => (
          <div key={s.id} className={cx('card flex gap-4 p-4', !s.isActive && 'opacity-60')}>
            <Avatar src={s.avatarUrl} name={s.displayName} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{s.displayName} {!s.isActive && <span className="chip bg-sand-100">Inactivo</span>}</p>
              <p className="text-xs text-ink-500">{s.title} · {s.email}</p>
              <Stars value={s.ratingAvg} size="sm" count={s.ratingCount} />
              <p className="mt-1 text-xs text-ink-500">{s.serviceIds.map((id) => data.services.find((x) => x.id === id)?.name).filter(Boolean).join(' · ') || 'Sin servicios asignados'}</p>
            </div>
            <div className="flex flex-col gap-1">
              <button onClick={() => setEditing(s)} className="btn-ghost !p-2" aria-label="Editar"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => setSchedule(s)} className="btn-ghost !p-2" aria-label="Horario"><CalendarCog className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!creating} onClose={() => setCreating(null)} title="Nuevo profesional">
        {creating && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre"><input className="input" value={creating.firstName} onChange={(e) => setCreating({ ...creating, firstName: e.target.value })} /></Field>
              <Field label="Apellido"><input className="input" value={creating.lastName} onChange={(e) => setCreating({ ...creating, lastName: e.target.value })} /></Field>
              <Field label="Correo"><input className="input" type="email" value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} /></Field>
              <Field label="Contraseña"><input className="input" type="password" value={creating.password} onChange={(e) => setCreating({ ...creating, password: e.target.value })} /></Field>
              <Field label="Cargo"><input className="input" value={creating.title} onChange={(e) => setCreating({ ...creating, title: e.target.value })} /></Field>
              <Field label="Teléfono"><input className="input" value={creating.phone} onChange={(e) => setCreating({ ...creating, phone: e.target.value })} /></Field>
            </div>
            <Field label="Foto (URL)"><input className="input" value={creating.avatarUrl} onChange={(e) => setCreating({ ...creating, avatarUrl: e.target.value })} /></Field>
            <Field label="Bio"><textarea className="input" value={creating.bio} onChange={(e) => setCreating({ ...creating, bio: e.target.value })} /></Field>
            <Field label="Servicios"><ServicePicker value={creating.serviceIds} onChange={(v) => setCreating({ ...creating, serviceIds: v })} /></Field>
            <p className="text-xs text-ink-500">Se creará con horario L–V 09:00–18:00; edítalo luego desde el ícono de calendario.</p>
            <div className="flex justify-end gap-2"><button onClick={() => setCreating(null)} className="btn-ghost">Cancelar</button><button onClick={create} disabled={busy} className="btn-primary">{busy ? <Spinner className="text-white" /> : 'Crear'}</button></div>
          </div>
        )}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar profesional">
        {editing && (
          <div className="space-y-3">
            <Field label="Nombre visible"><input className="input" value={editing.displayName} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cargo"><input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
              <Field label="Teléfono"><input className="input" value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            </div>
            <Field label="Foto (URL)"><input className="input" value={editing.avatarUrl ?? ''} onChange={(e) => setEditing({ ...editing, avatarUrl: e.target.value })} /></Field>
            <Field label="Bio"><textarea className="input" value={editing.bio} onChange={(e) => setEditing({ ...editing, bio: e.target.value })} /></Field>
            <Field label="Servicios"><ServicePicker value={editing.serviceIds} onChange={(v) => setEditing({ ...editing, serviceIds: v })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> Activo</label>
            <div className="flex justify-end gap-2"><button onClick={() => setEditing(null)} className="btn-ghost">Cancelar</button><button onClick={update} disabled={busy} className="btn-primary">{busy ? <Spinner className="text-white" /> : 'Guardar'}</button></div>
          </div>
        )}
      </Modal>

      <Modal open={!!schedule} onClose={() => setSchedule(null)} title={`Horario · ${schedule?.displayName ?? ''}`} wide>
        {schedule && <ScheduleEditor staffId={schedule.id} />}
      </Modal>
    </div>
  );
}
