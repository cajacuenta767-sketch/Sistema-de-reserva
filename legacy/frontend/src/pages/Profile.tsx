import { useState, type FormEvent } from 'react';
import { patch, post } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useToast } from '@/store/toast';
import { Field, Spinner } from '@/components/ui';

export function Profile() {
  const { user, refreshMe } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ firstName: user?.firstName ?? '', lastName: user?.lastName ?? '', phone: user?.phone ?? '', address: user?.address ?? '', city: user?.city ?? '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await patch('/auth/me', { ...form, phone: form.phone || null, address: form.address || null, city: form.city || null }); await refreshMe(); toast('Perfil actualizado', 'success'); }
    catch (err) { toast((err as Error).message, 'error'); } finally { setBusy(false); }
  };
  const changePw = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await post('/auth/change-password', pw); setPw({ currentPassword: '', newPassword: '' }); toast('Contraseña cambiada', 'success'); }
    catch (err) { toast((err as Error).message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 animate-fade-up">
      <div>
        <h1 className="section-title">Mi perfil</h1>
        <p className="text-ink-500">{user?.email} · <span className="chip bg-sand-100 text-ink-700">{user?.role}</span></p>
      </div>
      <form onSubmit={save} className="card space-y-4 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre"><input className="input" value={form.firstName} onChange={set('firstName')} required /></Field>
          <Field label="Apellido"><input className="input" value={form.lastName} onChange={set('lastName')} required /></Field>
          <Field label="Teléfono"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="Ciudad"><input className="input" value={form.city} onChange={set('city')} /></Field>
        </div>
        <Field label="Dirección"><input className="input" value={form.address} onChange={set('address')} placeholder="Calle 80 # 63-21" /></Field>
        <button className="btn-primary" disabled={busy}>{busy ? <Spinner className="text-white" /> : 'Guardar cambios'}</button>
      </form>
      <form onSubmit={changePw} className="card space-y-4 p-6">
        <h2 className="font-semibold">Cambiar contraseña</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Actual"><input className="input" type="password" value={pw.currentPassword} onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} required /></Field>
          <Field label="Nueva"><input className="input" type="password" minLength={8} value={pw.newPassword} onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} required /></Field>
        </div>
        <button className="btn-secondary" disabled={busy}>Actualizar contraseña</button>
      </form>
    </div>
  );
}
