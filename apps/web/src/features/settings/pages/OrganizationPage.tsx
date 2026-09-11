import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, PageHeader, PageLoader, cx } from '@/design-system';
import { get, patch } from '@/lib/api/client';
import { useAuth } from '@/store/auth';
import { useToast } from '@/store/toast';
import { useCan } from '@/lib/authz/useCan';

interface Organization {
  id: string;
  legalName: string;
  tradeName: string;
  taxId: string | null;
  taxIdDv: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  functionalCurrency: string;
  brandHue: number | null;
}

/** Matices con nombre. Cambiar uno recolorea la aplicación entera al instante. */
const BRAND_PRESETS = [
  { hue: 262.9, name: 'Azul corporativo' },
  { hue: 210, name: 'Azul cielo' },
  { hue: 165, name: 'Verde esmeralda' },
  { hue: 300, name: 'Violeta' },
  { hue: 25, name: 'Naranja' },
  { hue: 350, name: 'Rojo' },
];

export function OrganizationPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refreshSession } = useAuth();
  const can = useCan();
  const readOnly = !can('org:organization:update');

  const query = useQuery({ queryKey: ['/organization'], queryFn: () => get<Organization>('/organization') });

  // Borrador superpuesto sobre los datos del servidor. Copiarlos a un estado con
  // un efecto provoca renders en cascada y, peor, pisa lo que el usuario esté
  // escribiendo si la consulta se revalida mientras edita.
  const [draft, setDraft] = useState<Partial<Organization>>({});
  const form: Partial<Organization> = { ...query.data, ...draft };
  const setForm = (update: (prev: Partial<Organization>) => Partial<Organization>) =>
    setDraft((prev) => update({ ...query.data, ...prev }));

  const save = useMutation({
    mutationFn: () =>
      patch<Organization>('/organization', {
        legalName: form.legalName,
        tradeName: form.tradeName,
        taxId: form.taxId || null,
        city: form.city || null,
        address: form.address || null,
        phone: form.phone || null,
        email: form.email || null,
        website: form.website || null,
        brandHue: form.brandHue ?? null,
      }),
    onSuccess: () => {
      toast.success('Datos guardados');
      void queryClient.invalidateQueries({ queryKey: ['/organization'] });
      // La sesión lleva el matiz de marca: hay que refrescarla para que el
      // color nuevo persista al recargar.
      void refreshSession();
    },
    onError: toast.error,
  });

  if (query.isLoading) return <PageLoader />;

  const set = (key: keyof Organization) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <>
      <PageHeader title="Empresa" description="Datos legales, contacto e identidad visual" />

      <form
        className="grid max-w-3xl gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <section className="card space-y-4 p-4">
          <h2 className="text-sm font-medium text-fg">Identificación</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Razón social" required>
              {(props) => (
                <Input
                  {...props}
                  disabled={readOnly}
                  value={form.legalName ?? ''}
                  onChange={set('legalName')}
                />
              )}
            </Field>
            <Field label="Nombre comercial" required>
              {(props) => (
                <Input
                  {...props}
                  disabled={readOnly}
                  value={form.tradeName ?? ''}
                  onChange={set('tradeName')}
                />
              )}
            </Field>
            <Field
              label="NIT"
              hint={
                form.taxIdDv
                  ? `Dígito de verificación: ${form.taxIdDv} (calculado)`
                  : 'El dígito de verificación se calcula solo'
              }
            >
              {(props) => (
                <Input {...props} disabled={readOnly} value={form.taxId ?? ''} onChange={set('taxId')} />
              )}
            </Field>
            <Field label="Moneda">
              {(props) => <Input {...props} disabled value={form.functionalCurrency ?? 'COP'} readOnly />}
            </Field>
          </div>
        </section>

        <section className="card space-y-4 p-4">
          <h2 className="text-sm font-medium text-fg">Contacto</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ciudad">
              {(props) => (
                <Input {...props} disabled={readOnly} value={form.city ?? ''} onChange={set('city')} />
              )}
            </Field>
            <Field label="Teléfono">
              {(props) => (
                <Input {...props} disabled={readOnly} value={form.phone ?? ''} onChange={set('phone')} />
              )}
            </Field>
            <Field label="Dirección" className="sm:col-span-2">
              {(props) => (
                <Input {...props} disabled={readOnly} value={form.address ?? ''} onChange={set('address')} />
              )}
            </Field>
            <Field label="Correo">
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  disabled={readOnly}
                  value={form.email ?? ''}
                  onChange={set('email')}
                />
              )}
            </Field>
            <Field label="Sitio web">
              {(props) => (
                <Input
                  {...props}
                  type="url"
                  disabled={readOnly}
                  value={form.website ?? ''}
                  onChange={set('website')}
                />
              )}
            </Field>
          </div>
        </section>

        <section className="card space-y-4 p-4">
          <h2 className="text-sm font-medium text-fg">Color de marca</h2>
          <p className="text-sm text-fg-muted">
            Un solo número define toda la paleta. La vista previa se aplica al instante.
          </p>

          <div className="flex flex-wrap gap-2">
            {BRAND_PRESETS.map((preset) => (
              <button
                key={preset.hue}
                type="button"
                disabled={readOnly}
                onClick={() => {
                  setForm((prev) => ({ ...prev, brandHue: preset.hue }));
                  document.documentElement.style.setProperty('--brand-h', String(preset.hue));
                }}
                className={cx(
                  'flex items-center gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-sm transition-colors',
                  form.brandHue === preset.hue
                    ? 'border-accent bg-accent-soft'
                    : 'border-border hover:bg-surface-2',
                )}
              >
                <span
                  className="size-4 rounded-full"
                  style={{ background: `oklch(0.546 0.245 ${preset.hue})` }}
                  aria-hidden
                />
                {preset.name}
              </button>
            ))}
          </div>

          <Field label="Matiz exacto" hint="0–360. Útil para igualar un color de marca existente.">
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                max={360}
                step={1}
                disabled={readOnly}
                value={form.brandHue ?? 262.9}
                onChange={(e) => {
                  const hue = Number(e.target.value);
                  setForm((prev) => ({ ...prev, brandHue: hue }));
                  document.documentElement.style.setProperty('--brand-h', String(hue));
                }}
              />
            )}
          </Field>
        </section>

        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={save.isPending}>
              Guardar cambios
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
