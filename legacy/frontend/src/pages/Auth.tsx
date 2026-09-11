import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CalendarCheck2 } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useToast } from '@/store/toast';
import { Field, Spinner } from '@/components/ui';
import type { User } from '@/api/types';

const homeFor = (u: User) => (u.role === 'ADMIN' ? '/admin' : u.role === 'STAFF' ? '/staff/agenda' : '/mis-reservas');

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md animate-fade-up">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lift"><CalendarCheck2 className="h-6 w-6" /></span>
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-ink-500">{subtitle}</p>
      </div>
      <div className="card p-6 sm:p-8">{children}</div>
      <p className="mt-4 text-center text-sm text-ink-500">{footer}</p>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const u = await login(email, password);
      toast(`¡Hola de nuevo, ${u.firstName}!`, 'success');
      navigate((loc.state as { from?: string } | null)?.from ?? homeFor(u), { replace: true });
    } catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Bienvenido" subtitle="Ingresa para gestionar tus reservas" footer={<>¿No tienes cuenta? <Link to="/registro" className="font-semibold text-brand-700">Crear cuenta</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Correo"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.com" autoComplete="email" /></Field>
        <Field label="Contraseña"><input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" /></Field>
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner className="text-white" /> : 'Entrar'}</button>
      </form>
      <div className="mt-5 rounded-2xl bg-sand-100 p-4 text-xs text-ink-500">
        <p className="mb-1 font-semibold text-ink-700">Cuentas de demostración (contraseña <code>Reserva123!</code>):</p>
        <ul className="space-y-0.5">
          <li>Cliente: <button type="button" className="font-mono text-brand-700" onClick={() => { setEmail('paola@gmail.com'); setPassword('Reserva123!'); }}>paola@gmail.com</button></li>
          <li>Profesional: <button type="button" className="font-mono text-brand-700" onClick={() => { setEmail('daniel@reservaflow.app'); setPassword('Reserva123!'); }}>daniel@reservaflow.app</button></li>
          <li>Admin: <button type="button" className="font-mono text-brand-700" onClick={() => { setEmail('admin@reservaflow.app'); setPassword('Reserva123!'); }}>admin@reservaflow.app</button></li>
        </ul>
      </div>
    </AuthLayout>
  );
}

export function Register() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await register({ ...form, phone: form.phone || undefined });
      toast('Cuenta creada. ¡Bienvenido!', 'success');
      navigate((loc.state as { from?: string } | null)?.from ?? '/reservar', { replace: true });
    } catch (err) { toast((err as Error).message, 'error'); }
    finally { setBusy(false); }
  };

  return (
    <AuthLayout title="Crea tu cuenta" subtitle="Solo toma un minuto" footer={<>¿Ya tienes cuenta? <Link to="/login" className="font-semibold text-brand-700">Entrar</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre"><input className="input" required value={form.firstName} onChange={set('firstName')} /></Field>
          <Field label="Apellido"><input className="input" required value={form.lastName} onChange={set('lastName')} /></Field>
        </div>
        <Field label="Correo"><input className="input" type="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Teléfono (opcional)"><input className="input" value={form.phone} onChange={set('phone')} placeholder="+57 300 000 0000" /></Field>
        <Field label="Contraseña" hint="Mínimo 8 caracteres"><input className="input" type="password" required minLength={8} value={form.password} onChange={set('password')} autoComplete="new-password" /></Field>
        <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner className="text-white" /> : 'Crear cuenta'}</button>
      </form>
    </AuthLayout>
  );
}
