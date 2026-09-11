import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Mail, Phone, Plus, Star, Trash2, User } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, Empty, Field, Input, Textarea } from '@/design-system';
import { del, patch, post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import type { Contact } from '../lib/types';

interface Props {
  partyId: string;
  contacts: Contact[];
  onChanged: () => void;
}

/** Las personas con las que se habla dentro de la empresa. */
export function ContactsPanel({ partyId, contacts, onChanged }: Props) {
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const toast = useToast();
  const can = useCan();

  const remove = useMutation({
    mutationFn: (id: string) => del(`/contacts/${id}`),
    onSuccess: () => {
      toast.success('Contacto eliminado');
      onChanged();
    },
    onError: toast.error,
  });

  const makePrimary = useMutation({
    mutationFn: (id: string) => patch(`/contacts/${id}`, { isPrimary: true }),
    onSuccess: () => {
      toast.success('Contacto principal actualizado');
      onChanged();
    },
    onError: toast.error,
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can perm="crm:contact:create">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
            Añadir contacto
          </Button>
        </Can>
      </div>

      {contacts.length === 0 ? (
        <Empty
          icon={<User className="size-6" />}
          title="Sin contactos"
          description="Añade a quien atiende el teléfono o firma los pedidos."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {contacts.map((contact) => (
            <li key={contact.id} className="card space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {contact.firstName} {contact.lastName}
                    </span>
                    {contact.isPrimary && <Badge tone="accent">Principal</Badge>}
                  </div>
                  {contact.jobTitle && <p className="text-sm text-fg-muted">{contact.jobTitle}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {!contact.isPrimary && can('crm:contact:update') && (
                    <Button
                      size="sm"
                      icon={<Star className="size-4" />}
                      aria-label="Marcar como principal"
                      onClick={() => makePrimary.mutate(contact.id)}
                    />
                  )}
                  {can('crm:contact:update') && (
                    <Button size="sm" onClick={() => setEditing(contact)}>
                      Editar
                    </Button>
                  )}
                  {can('crm:contact:delete') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-4" />}
                      aria-label="Eliminar contacto"
                      onClick={() => remove.mutate(contact.id)}
                    />
                  )}
                </div>
              </div>
              <div className="space-y-1 text-sm">
                {contact.email && (
                  <a className="flex items-center gap-2 text-accent hover:underline" href={`mailto:${contact.email}`}>
                    <Mail className="size-4 shrink-0" />
                    <span className="truncate">{contact.email}</span>
                  </a>
                )}
                {(contact.mobile ?? contact.phone) && (
                  <a
                    className="flex items-center gap-2 text-accent hover:underline"
                    href={`tel:${contact.mobile ?? contact.phone}`}
                  >
                    <Phone className="size-4 shrink-0" />
                    {contact.mobile ?? contact.phone}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <ContactDialog
          partyId={partyId}
          contact={editing === 'new' ? null : editing}
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

function ContactDialog({
  partyId,
  contact,
  onClose,
  onSaved,
}: {
  partyId: string;
  contact: Contact | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState({
    firstName: contact?.firstName ?? '',
    lastName: contact?.lastName ?? '',
    jobTitle: contact?.jobTitle ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    mobile: contact?.mobile ?? '',
    isPrimary: contact?.isPrimary ?? false,
    notes: contact?.notes ?? '',
  });
  const [error, setError] = useState('');

  const set = (key: keyof typeof values, value: string | boolean) =>
    setValues((v) => ({ ...v, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        partyId,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        jobTitle: blank(values.jobTitle),
        email: blank(values.email),
        phone: blank(values.phone),
        mobile: blank(values.mobile),
        isPrimary: values.isPrimary,
        notes: blank(values.notes),
      };
      return contact ? patch(`/contacts/${contact.id}`, body) : post('/contacts', body);
    },
    onSuccess: () => {
      toast.success(contact ? 'Contacto actualizado' : 'Contacto añadido');
      onSaved();
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!values.firstName.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={contact ? 'Editar contacto' : 'Nuevo contacto'}
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
          <Field label="Nombre" required error={error}>
            {(props) => (
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un diálogo el foco ya está atrapado
              <Input {...props} autoFocus value={values.firstName} onChange={(e) => set('firstName', e.target.value)} />
            )}
          </Field>
          <Field label="Apellidos">
            {(props) => <Input {...props} value={values.lastName} onChange={(e) => set('lastName', e.target.value)} />}
          </Field>
          <Field label="Cargo" className="sm:col-span-2">
            {(props) => <Input {...props} value={values.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} />}
          </Field>
          <Field label="Correo">
            {(props) => (
              <Input {...props} type="email" value={values.email} onChange={(e) => set('email', e.target.value)} />
            )}
          </Field>
          <Field label="Celular">
            {(props) => <Input {...props} value={values.mobile} onChange={(e) => set('mobile', e.target.value)} />}
          </Field>
          <Field label="Notas" className="sm:col-span-2">
            {(props) => <Textarea {...props} value={values.notes} onChange={(e) => set('notes', e.target.value)} />}
          </Field>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-accent)]"
              checked={values.isPrimary}
              onChange={(e) => set('isPrimary', e.target.checked)}
            />
            Es el contacto principal
          </label>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const blank = (value: string): string | null => (value.trim().length > 0 ? value.trim() : null);
