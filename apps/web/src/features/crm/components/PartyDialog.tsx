import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, Field, Input, Select, Textarea } from '@/design-system';
import { patch, post } from '@/lib/api/client';
import { useToast } from '@/store/toast';
import { TAX_ID_TYPES, TAX_REGIMES } from '../lib/party';

export interface PartyFormValues {
  kind: 'PERSON' | 'COMPANY';
  displayName: string;
  legalName: string;
  taxIdType: string;
  taxId: string;
  taxIdDv: string;
  taxRegime: string;
  email: string;
  phone: string;
  mobile: string;
  website: string;
  industry: string;
  notes: string;
  isCustomer: boolean;
  isVendor: boolean;
}

const EMPTY: PartyFormValues = {
  kind: 'COMPANY',
  displayName: '',
  legalName: '',
  taxIdType: 'NIT',
  taxId: '',
  taxIdDv: '',
  taxRegime: 'COMUN',
  email: '',
  phone: '',
  mobile: '',
  website: '',
  industry: '',
  notes: '',
  isCustomer: true,
  isVendor: false,
};

interface Props {
  /** Ficha existente: si se pasa, el diálogo edita en lugar de crear. */
  partyId?: string;
  initial?: Partial<PartyFormValues>;
  onClose: () => void;
  onSaved: (id: string) => void;
}

/**
 * Alta y edición de una ficha.
 *
 * Los campos vacíos se envían como `null` y no como `''`: el backend distingue
 * "sin dato" de "dato en blanco", y guardar cadenas vacías llena la base de
 * huecos que luego nadie sabe si son un olvido o una decisión.
 */
export function PartyDialog({ partyId, initial, onClose, onSaved }: Props) {
  const toast = useToast();
  const [values, setValues] = useState<PartyFormValues>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof PartyFormValues>(key: K, value: PartyFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        kind: values.kind,
        displayName: values.displayName.trim(),
        legalName: blank(values.legalName),
        taxIdType: values.taxIdType,
        taxId: blank(values.taxId),
        taxIdDv: blank(values.taxIdDv),
        taxRegime: values.taxRegime,
        email: blank(values.email),
        phone: blank(values.phone),
        mobile: blank(values.mobile),
        website: blank(values.website),
        industry: blank(values.industry),
        notes: blank(values.notes),
        isCustomer: values.isCustomer,
        isVendor: values.isVendor,
      };
      return partyId
        ? patch<{ id: string }>(`/parties/${partyId}`, body)
        : post<{ id: string }>('/parties', body);
    },
    onSuccess: (party) => {
      toast.success(partyId ? 'Ficha actualizada' : 'Ficha creada');
      onSaved(party.id);
    },
    onError: (error: Error) => {
      // El backend devuelve el conflicto del NIT con su mensaje; mostrarlo
      // junto al campo evita que el usuario tenga que adivinar cuál falló.
      if (/documento/i.test(error.message)) setErrors({ taxId: error.message });
      toast.error(error);
    },
  });

  const submit = () => {
    if (!values.displayName.trim()) {
      setErrors({ displayName: 'El nombre es obligatorio' });
      return;
    }
    setErrors({});
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={partyId ? 'Editar ficha' : 'Nueva ficha'}
        description="Una misma empresa puede ser cliente y proveedor a la vez."
        size="lg"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              {partyId ? 'Guardar' : 'Crear'}
            </Button>
          </>
        }
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Tipo" className="sm:col-span-1">
            {(props) => (
              <Select
                {...props}
                value={values.kind}
                onChange={(e) => set('kind', e.target.value as PartyFormValues['kind'])}
              >
                <option value="COMPANY">Empresa</option>
                <option value="PERSON">Persona natural</option>
              </Select>
            )}
          </Field>

          <Field label="Régimen" className="sm:col-span-1">
            {(props) => (
              <Select {...props} value={values.taxRegime} onChange={(e) => set('taxRegime', e.target.value)}>
                {TAX_REGIMES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Nombre"
            required
            error={errors.displayName}
            hint="Como se le conoce; es lo que aparece en los listados"
            className="sm:col-span-2"
          >
            {(props) => (
              <Input
                {...props}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un diálogo el foco ya está atrapado
                autoFocus
                value={values.displayName}
                onChange={(e) => set('displayName', e.target.value)}
              />
            )}
          </Field>

          <Field label="Razón social" className="sm:col-span-2" hint="La que aparece en la factura">
            {(props) => (
              <Input {...props} value={values.legalName} onChange={(e) => set('legalName', e.target.value)} />
            )}
          </Field>

          <Field label="Tipo de documento">
            {(props) => (
              <Select {...props} value={values.taxIdType} onChange={(e) => set('taxIdType', e.target.value)}>
                {TAX_ID_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Field
              label="Número"
              error={errors.taxId}
              hint="Puedes escribirlo con puntos: se normaliza solo"
            >
              {(props) => (
                <Input
                  {...props}
                  value={values.taxId}
                  onChange={(e) => set('taxId', e.target.value)}
                  inputMode="numeric"
                />
              )}
            </Field>
            <Field label="DV" hint="Se calcula">
              {(props) => (
                <Input
                  {...props}
                  value={values.taxIdDv}
                  onChange={(e) => set('taxIdDv', e.target.value)}
                  maxLength={1}
                  inputMode="numeric"
                />
              )}
            </Field>
          </div>

          <Field label="Correo">
            {(props) => (
              <Input
                {...props}
                type="email"
                value={values.email}
                onChange={(e) => set('email', e.target.value)}
              />
            )}
          </Field>

          <Field label="Teléfono">
            {(props) => (
              <Input {...props} value={values.phone} onChange={(e) => set('phone', e.target.value)} />
            )}
          </Field>

          <Field label="Celular">
            {(props) => (
              <Input {...props} value={values.mobile} onChange={(e) => set('mobile', e.target.value)} />
            )}
          </Field>

          <Field label="Sector">
            {(props) => (
              <Input {...props} value={values.industry} onChange={(e) => set('industry', e.target.value)} />
            )}
          </Field>

          <Field label="Sitio web" className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                type="url"
                placeholder="https://"
                value={values.website}
                onChange={(e) => set('website', e.target.value)}
              />
            )}
          </Field>

          <Field label="Notas" className="sm:col-span-2">
            {(props) => (
              <Textarea {...props} value={values.notes} onChange={(e) => set('notes', e.target.value)} />
            )}
          </Field>

          <fieldset className="sm:col-span-2 flex flex-wrap gap-4 rounded-[var(--radius-control)] border border-border p-3">
            <legend className="px-1 text-xs font-medium text-fg-muted">Qué es para ti</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={values.isCustomer}
                onChange={(e) => set('isCustomer', e.target.checked)}
              />
              Cliente
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--color-accent)]"
                checked={values.isVendor}
                onChange={(e) => set('isVendor', e.target.checked)}
              />
              Proveedor
            </label>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Vacío significa "sin dato", no "dato en blanco". */
const blank = (value: string): string | null => (value.trim().length > 0 ? value.trim() : null);
