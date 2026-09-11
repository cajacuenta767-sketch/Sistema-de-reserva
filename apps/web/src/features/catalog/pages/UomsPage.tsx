import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Ruler, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Empty,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
} from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { del, post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { DIMENSIONS, dimensionLabel } from '../lib/labels';
import type { Uom } from '../lib/types';

/**
 * Unidades de medida.
 *
 * Agrupadas por dimensión porque solo se convierten entre sí las de la misma:
 * mostrarlas en una lista plana sugiere que kilos y metros son intercambiables,
 * que es justo el error que el sistema rechaza.
 */
export function UomsPage() {
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const query = useCollection<Uom>('/uoms');
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['/uoms'] });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/uoms/${id}`),
    onSuccess: () => {
      toast.success('Unidad eliminada');
      invalidate();
    },
    onError: toast.error,
  });

  const items = query.data?.items ?? [];
  const byDimension = DIMENSIONS.map((d) => ({
    ...d,
    uoms: items.filter((u) => u.dimension === d.value),
  })).filter((g) => g.uoms.length > 0);

  return (
    <>
      <PageHeader
        title="Unidades de medida"
        description="Solo se convierten entre sí las unidades que miden lo mismo"
        actions={
          <Can perm="catalog:uom:manage">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nueva unidad
            </Button>
          </Can>
        }
      />

      {query.isLoading && <Spinner />}
      {!query.isLoading && items.length === 0 && (
        <Empty icon={<Ruler className="size-6" />} title="Sin unidades configuradas" />
      )}

      {byDimension.map((group) => {
        const base = group.uoms.find((u) => u.isBase);
        return (
          <section key={group.value} className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">{group.label}</h2>
              {base && (
                <p className="text-sm text-fg-muted">
                  Las existencias se guardan en <strong>{base.name.toLowerCase()}</strong>; el factor dice
                  cuántas equivale cada unidad.
                </p>
              )}
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.uoms.map((uom) => (
                <li key={uom.id} className="card flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-fg-subtle">{uom.code}</span>
                      {uom.isBase && <Badge tone="accent">Base</Badge>}
                      {!uom.isActive && <Badge tone="neutral">Inactiva</Badge>}
                    </div>
                    <p className="truncate font-medium">{uom.name}</p>
                    <p className="text-xs text-fg-muted">
                      × {uom.factor}
                      {uom.precision === 0 ? ' · sin decimales' : ` · ${uom.precision} decimales`}
                      {uom.dianCode && ` · DIAN ${uom.dianCode}`}
                    </p>
                  </div>
                  {can('catalog:uom:manage') && !uom.isBase && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-4" />}
                      aria-label={`Eliminar ${uom.name}`}
                      onClick={() => remove.mutate(uom.id)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {creating && (
        <UomDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}

function UomDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState({
    code: '',
    name: '',
    dimension: 'UNIT',
    factor: '1',
    precision: '0',
    dianCode: '',
  });
  const [error, setError] = useState('');

  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const save = useMutation({
    mutationFn: () =>
      post('/uoms', {
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        dimension: values.dimension,
        factor: values.factor.replace(',', '.') || '1',
        precision: Number(values.precision),
        dianCode: values.dianCode.trim() || null,
      }),
    onSuccess: () => {
      toast.success('Unidad creada');
      onSaved();
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!values.code.trim() || !values.name.trim()) {
      setError('El código y el nombre son obligatorios');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title="Nueva unidad"
        description="El factor dice cuántas unidades base vale una de ésta: una caja de 12 tiene factor 12."
        size="md"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              Crear
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
          {error && <p className="sm:col-span-2 text-sm text-danger-fg">{error}</p>}

          <Field label="Código" required>
            {(props) => (
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un diálogo el foco ya está atrapado
              <Input {...props} autoFocus placeholder="CJ6" value={values.code} onChange={(e) => set('code', e.target.value)} />
            )}
          </Field>
          <Field label="Nombre" required>
            {(props) => (
              <Input {...props} placeholder="Caja x 6" value={values.name} onChange={(e) => set('name', e.target.value)} />
            )}
          </Field>
          <Field label="Mide" hint="No se puede cambiar después">
            {(props) => (
              <Select {...props} value={values.dimension} onChange={(e) => set('dimension', e.target.value)}>
                {DIMENSIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Factor" hint={`Cuántas unidades base (${dimensionLabel(values.dimension).toLowerCase()})`}>
            {(props) => (
              <Input {...props} inputMode="decimal" value={values.factor} onChange={(e) => set('factor', e.target.value)} />
            )}
          </Field>
          <Field label="Decimales" hint="0 para cosas que no se parten">
            {(props) => (
              <Select {...props} value={values.precision} onChange={(e) => set('precision', e.target.value)}>
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Código DIAN" hint="UN/ECE rec. 20; obligatorio al facturar">
            {(props) => (
              <Input {...props} placeholder="BX" value={values.dianCode} onChange={(e) => set('dianCode', e.target.value)} />
            )}
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
