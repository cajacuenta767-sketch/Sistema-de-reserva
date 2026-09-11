import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '@/design-system';
import { useAuth } from '@/store/auth';
import { ApiError } from '@/lib/api/client';
import { AuthLayout } from './AuthLayout';

interface FieldErrors {
  [path: string]: string;
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    organizationName: '',
  });
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setFieldErrors({});
    try {
      await register(form);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray(err.details)) {
        // El backend devuelve `[{ path: 'body.password', message }]`: se muestran
        // bajo su campo en vez de amontonarlos arriba.
        const errors: FieldErrors = {};
        for (const issue of err.details as Array<{ path: string; message: string }>) {
          errors[issue.path.replace(/^body\./, '')] = issue.message;
        }
        setFieldErrors(errors);
        if (Object.keys(errors).length === 0) setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : 'No se pudo crear la cuenta');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Crear empresa"
      subtitle="Tu cuenta y tu empresa, en un paso"
      footer={
        <>
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Entrar
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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre" required error={fieldErrors.firstName}>
            {(props) => (
              // eslint-disable-next-line jsx-a11y/no-autofocus -- el formulario es toda la pantalla
              <Input {...props} required autoFocus value={form.firstName} onChange={set('firstName')} />
            )}
          </Field>
          <Field label="Apellido" required error={fieldErrors.lastName}>
            {(props) => <Input {...props} required value={form.lastName} onChange={set('lastName')} />}
          </Field>
        </div>

        <Field label="Correo" required error={fieldErrors.email}>
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={set('email')}
            />
          )}
        </Field>

        <Field
          label="Contraseña"
          required
          error={fieldErrors.password}
          hint="Mínimo 10 caracteres, con mayúscula, minúscula y número"
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={set('password')}
            />
          )}
        </Field>

        <Field label="Nombre de la empresa" required error={fieldErrors.organizationName}>
          {(props) => (
            <Input {...props} required value={form.organizationName} onChange={set('organizationName')} />
          )}
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting}>
          Crear empresa
        </Button>
      </form>
    </AuthLayout>
  );
}
