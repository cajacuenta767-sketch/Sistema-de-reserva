import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Clock, Mail, MessageCircle, Phone, Plus, StickyNote, Users } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, Empty, Field, Input, Select, Textarea } from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { dateTime, relative } from '@/lib/format';
import { ACTIVITY_KINDS, activityKindLabel } from '../lib/party';
import type { Activity } from '../lib/types';

const ICONS: Record<string, typeof Phone> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  NOTE: StickyNote,
  WHATSAPP: MessageCircle,
  TASK: Clock,
  VISIT: Users,
};

interface Props {
  partyId: string;
  /** Las que vinieron con la ficha; se refrescan al registrar una nueva. */
  activities: Activity[];
  onChanged: () => void;
}

/**
 * Historial de lo que ha pasado con esta empresa.
 *
 * Se recarga con su propia consulta en lugar de usar solo las que trae la ficha:
 * la ficha devuelve las últimas 20 para pintar el resumen, y aquí hacen falta
 * todas, con su cuerpo y su vencimiento.
 */
export function ActivitiesPanel({ partyId, activities, onChanged }: Props) {
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const can = useCan();
  const queryClient = useQueryClient();

  const query = useCollection<Activity>(`/activities?entityType=party&entityId=${partyId}`);
  const items = query.data?.items ?? activities;

  const complete = useMutation({
    mutationFn: (id: string) => post(`/activities/${id}/complete`),
    onSuccess: () => {
      toast.success('Tarea completada');
      void queryClient.invalidateQueries({ queryKey: [`/activities?entityType=party&entityId=${partyId}`] });
      onChanged();
    },
    onError: toast.error,
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Can perm="crm:activity:create">
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Registrar actividad
          </Button>
        </Can>
      </div>

      {items.length === 0 ? (
        <Empty
          icon={<StickyNote className="size-6" />}
          title="Sin actividad"
          description="Anota las llamadas y reuniones para que el historial sirva de algo."
        />
      ) : (
        <ol className="space-y-3">
          {items.map((activity) => {
            const Icon = ICONS[activity.kind] ?? StickyNote;
            const pending = activity.completedAt === null;
            const overdue = pending && activity.dueAt !== null && new Date(activity.dueAt) < new Date();

            return (
              <li key={activity.id} className="card flex gap-3 p-4">
                <span
                  className={
                    overdue
                      ? 'mt-0.5 shrink-0 rounded-full bg-danger-soft p-2 text-danger-soft-fg'
                      : 'mt-0.5 shrink-0 rounded-full bg-surface-2 p-2 text-fg-muted'
                  }
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{activity.subject}</span>
                    <Badge>{activityKindLabel(activity.kind)}</Badge>
                    {pending && (
                      <Badge tone={overdue ? 'danger' : 'warning'} dot>
                        {overdue ? 'Vencida' : 'Pendiente'}
                      </Badge>
                    )}
                  </div>
                  {activity.body && (
                    <p className="text-sm whitespace-pre-wrap text-fg-muted">{activity.body}</p>
                  )}
                  <p className="text-xs text-fg-subtle">
                    {relative(activity.createdAt)}
                    {activity.dueAt && <> · vence {dateTime(activity.dueAt)}</>}
                  </p>
                </div>
                {pending && can('crm:activity:create') && (
                  <Button
                    size="sm"
                    icon={<Check className="size-4" />}
                    onClick={() => complete.mutate(activity.id)}
                  >
                    Completar
                  </Button>
                )}
                {!pending && <CheckCircle2 className="mt-1 size-4 shrink-0 text-success" />}
              </li>
            );
          })}
        </ol>
      )}

      {creating && (
        <ActivityDialog
          partyId={partyId}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void queryClient.invalidateQueries({
              queryKey: [`/activities?entityType=party&entityId=${partyId}`],
            });
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ActivityDialog({
  partyId,
  onClose,
  onSaved,
}: {
  partyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState({ kind: 'NOTE', subject: '', body: '', dueAt: '' });
  const [error, setError] = useState('');

  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const save = useMutation({
    mutationFn: () =>
      post('/activities', {
        kind: values.kind,
        entityType: 'party',
        entityId: partyId,
        subject: values.subject.trim(),
        body: values.body.trim() || null,
        // Una tarea con vencimiento nace pendiente; una nota nace completada.
        // Esa regla vive en el backend: aquí solo se manda la fecha si la hay.
        dueAt: values.dueAt ? new Date(values.dueAt).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success('Actividad registrada');
      onSaved();
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!values.subject.trim()) {
      setError('Escribe de qué se trata');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Registrar actividad"
        size="md"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Registrar
            </Button>
          </>
        }
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Tipo">
            {(props) => (
              <Select {...props} value={values.kind} onChange={(e) => set('kind', e.target.value)}>
                {ACTIVITY_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Asunto" required error={error}>
            {(props) => (
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un diálogo el foco ya está atrapado
              <Input {...props} autoFocus value={values.subject} onChange={(e) => set('subject', e.target.value)} />
            )}
          </Field>
          <Field label="Detalle">
            {(props) => <Textarea {...props} value={values.body} onChange={(e) => set('body', e.target.value)} />}
          </Field>
          <Field label="Vencimiento" hint="Si la dejas vacía, queda registrada como hecha">
            {(props) => (
              <Input
                {...props}
                type="datetime-local"
                value={values.dueAt}
                onChange={(e) => set('dueAt', e.target.value)}
              />
            )}
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
