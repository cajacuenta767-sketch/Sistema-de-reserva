import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MapPin, Plus, Star, Trash2 } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, Empty, Field, Input, Select } from '@/design-system';
import { del, patch, post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { ADDRESS_KINDS, addressKindLabel } from '../lib/party';
import type { PartyAddress } from '../lib/types';

interface Props {
  partyId: string;
  addresses: PartyAddress[];
  onChanged: () => void;
}

export function AddressesPanel({ partyId, addresses, onChanged }: Props) {
  const [editing, setEditing] = useState<PartyAddress | 'new' | null>(null);
  const toast = useToast();
  const can = useCan();

  const remove = useMutation({
    mutationFn: (id: string) => del(`/addresses/${id}`),
    onSuccess: () => {
      toast.success('Dirección eliminada');
      onChanged();
    },
    onError: toast.error,
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => patch(`/addresses/${id}`, { isDefault: true }),
    onSuccess: () => {
      toast.success('Dirección principal actualizada');
      onChanged();
    },
    onError: toast.error,
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can perm="crm:party:update">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Añadir dirección
          </Button>
        </Can>
      </div>

      {addresses.length === 0 ? (
        <Empty
          icon={<MapPin className="size-6" />}
          title="Sin direcciones"
          description="La dirección de facturación es obligatoria para emitir documentos."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {addresses.map((address) => (
            <li key={address.id} className="card space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{addressKindLabel(address.kind)}</Badge>
                  {address.isDefault && <Badge tone="accent">Principal</Badge>}
                  {address.label && <span className="text-sm text-fg-muted">{address.label}</span>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {!address.isDefault && can('crm:party:update') && (
                    <Button
                      size="sm"
                      icon={<Star className="size-4" />}
                      aria-label="Marcar como principal"
                      onClick={() => makeDefault.mutate(address.id)}
                    />
                  )}
                  {can('crm:party:update') && (
                    <Button size="sm" onClick={() => setEditing(address)}>
                      Editar
                    </Button>
                  )}
                  {can('crm:party:update') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-4" />}
                      aria-label="Eliminar dirección"
                      onClick={() => remove.mutate(address.id)}
                    />
                  )}
                </div>
              </div>
              <address className="text-sm not-italic text-fg-muted">
                {address.line1}
                {address.line2 && <>, {address.line2}</>}
                <br />
                {[address.city, address.state, address.postalCode].filter(Boolean).join(' · ')}
              </address>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <AddressDialog
          partyId={partyId}
          address={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function AddressDialog({
  partyId,
  address,
  onClose,
  onSaved,
}: {
  partyId: string;
  address: PartyAddress | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState({
    kind: address?.kind ?? 'MAIN',
    label: address?.label ?? '',
    line1: address?.line1 ?? '',
    line2: address?.line2 ?? '',
    city: address?.city ?? '',
    state: address?.state ?? '',
    country: address?.country ?? 'CO',
    postalCode: address?.postalCode ?? '',
    isDefault: address?.isDefault ?? false,
  });
  const [error, setError] = useState('');

  const set = (key: keyof typeof values, value: string | boolean) =>
    setValues((v) => ({ ...v, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        kind: values.kind,
        label: blank(values.label),
        line1: values.line1.trim(),
        line2: blank(values.line2),
        city: blank(values.city),
        state: blank(values.state),
        country: values.country || 'CO',
        postalCode: blank(values.postalCode),
        isDefault: values.isDefault,
      };
      return address
        ? patch(`/addresses/${address.id}`, body)
        : post(`/parties/${partyId}/addresses`, body);
    },
    onSuccess: () => {
      toast.success('Dirección guardada');
      onSaved();
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!values.line1.trim()) {
      setError('La dirección es obligatoria');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={address ? 'Editar dirección' : 'Nueva dirección'}
        size="md"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Guardar
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
          <Field label="Tipo">
            {(props) => (
              <Select {...props} value={values.kind} onChange={(e) => set('kind', e.target.value)}>
                {ADDRESS_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Etiqueta" hint="Bodega norte, oficina…">
            {(props) => <Input {...props} value={values.label} onChange={(e) => set('label', e.target.value)} />}
          </Field>
          <Field label="Dirección" required error={error} className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un diálogo el foco ya está atrapado
                autoFocus
                placeholder="Calle 10 # 5-20"
                value={values.line1}
                onChange={(e) => set('line1', e.target.value)}
              />
            )}
          </Field>
          <Field label="Complemento" className="sm:col-span-2" hint="Apartamento, torre, barrio">
            {(props) => <Input {...props} value={values.line2} onChange={(e) => set('line2', e.target.value)} />}
          </Field>
          <Field label="Ciudad">
            {(props) => <Input {...props} value={values.city} onChange={(e) => set('city', e.target.value)} />}
          </Field>
          <Field label="Departamento">
            {(props) => <Input {...props} value={values.state} onChange={(e) => set('state', e.target.value)} />}
          </Field>
          <Field label="País" hint="Código de dos letras">
            {(props) => (
              <Input {...props} maxLength={2} value={values.country} onChange={(e) => set('country', e.target.value.toUpperCase())} />
            )}
          </Field>
          <Field label="Código postal">
            {(props) => (
              <Input {...props} value={values.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
            )}
          </Field>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={values.isDefault}
              onChange={(e) => set('isDefault', e.target.checked)}
            />
            Es la dirección principal
          </label>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const blank = (value: string): string | null => (value.trim().length > 0 ? value.trim() : null);
