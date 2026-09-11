import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '@/design-system';
import { useAuth } from '@/store/auth';
import { ApiError } from '@/lib/api/client';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      // El servidor no distingue correo inexistente de contraseña incorrecta, y
      // aquí tampoco: decirlo permitiría enumerar qué correos tienen cuenta.
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Entrar"
      subtitle="Accede con tu cuenta"
      footer={
        <>
          ¿No tienes cuenta?{' '}
          <Link to="/registro" className="font-medium text-accent hover:underline">
            Crear una empresa
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && (
          <p
            role="alert"
            className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-sm text-danger-fg"
          >
            {error}
          </p>
        )}

        <Field label="Correo" required>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              // El foco automático desorienta cuando el formulario es una parte más
              // de la página; aquí ES la página (o el diálogo) entera.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>

        <Field label="Contraseña" required>
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          Entrar
        </Button>
      </form>
    </AuthLayout>
  );
}
