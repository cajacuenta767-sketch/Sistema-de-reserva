import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FolderTree, Plus, Trash2 } from 'lucide-react';
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
  Textarea,
} from '@/design-system';
import { useCollection } from '@/lib/api/useList';
import { del, patch, post } from '@/lib/api/client';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import type { Category } from '../lib/types';

/**
 * Árbol de categorías.
 *
 * El contador de cada rama incluye su descendencia: si "Bebidas" mostrara 0
 * porque todo cuelga de "Gaseosas", el árbol parecería vacío justo donde está
 * todo el catálogo.
 */
export function CategoriesPage() {
  const can = useCan();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);

  const query = useCollection<Category>('/product-categories');
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['/product-categories'] });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/product-categories/${id}`),
    onSuccess: () => {
      toast.success('Categoría eliminada');
      invalidate();
    },
    onError: toast.error,
  });

  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Categorías"
        description="Cómo se agrupa el catálogo. Al filtrar por una rama se incluye todo lo que cuelga de ella"
        actions={
          <Can perm="catalog:category:manage">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>
              Nueva categoría
            </Button>
          </Can>
        }
      />

      {query.isLoading && <Spinner />}
      {!query.isLoading && items.length === 0 && (
        <Empty
          icon={<FolderTree className="size-6" />}
          title="Sin categorías"
          description="Crea la primera para organizar tus productos."
        />
      )}

      {items.length > 0 && (
        <ul className="card divide-y divide-border">
          {items.map((category) => (
            <li key={category.id} className="flex items-center gap-3 p-3">
              <div
                className="min-w-0 flex-1"
                style={{ paddingInlineStart: `${category.depth * 1.25}rem` }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{category.name}</span>
                  {category.productCount > 0 && (
                    <Badge tone="neutral">{category.productCount} productos</Badge>
                  )}
                  {!category.isActive && <Badge tone="neutral">Inactiva</Badge>}
                </div>
                {category.description && (
                  <p className="truncate text-sm text-fg-muted">{category.description}</p>
                )}
              </div>

              <div className="flex shrink-0 gap-1">
                {category.productCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigate(`/productos?filter[category_id]=${category.id}`)}
                  >
                    Ver productos
                  </Button>
                )}
                {can('catalog:category:manage') && (
                  <>
                    <Button size="sm" onClick={() => setEditing(category)}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 className="size-4" />}
                      aria-label={`Eliminar ${category.name}`}
                      onClick={() => remove.mutate(category.id)}
                    />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CategoryDialog
          category={editing === 'new' ? null : editing}
          all={items}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </>
  );
}

function CategoryDialog({
  category,
  all,
  onClose,
  onSaved,
}: {
  category: Category | null;
  all: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState({
    name: category?.name ?? '',
    parentId: category?.parentId ?? '',
    description: category?.description ?? '',
  });
  const [error, setError] = useState('');

  const set = (key: keyof typeof values, value: string) => setValues((v) => ({ ...v, [key]: value }));

  // Una categoría no puede colgar de su propia descendencia; ofrecerlo y dejar
  // que el servidor lo rechace sería proponer un error.
  const candidates = all.filter(
    (c) =>
      !category ||
      (c.id !== category.id && !c.path.startsWith(`${category.path} / `)),
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: values.name.trim(),
        parentId: values.parentId || null,
        description: values.description.trim() || null,
      };
      return category ? patch(`/product-categories/${category.id}`, body) : post('/product-categories', body);
    },
    onSuccess: () => {
      toast.success('Categoría guardada');
      onSaved();
    },
    onError: toast.error,
  });

  const submit = () => {
    if (!values.name.trim()) {
      setError('El nombre es obligatorio');
      return;
    }
    if (values.name.includes('/')) {
      setError('El nombre no puede contener "/": es el separador de la ruta');
      return;
    }
    setError('');
    save.mutate();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={category ? 'Editar categoría' : 'Nueva categoría'}
        description={category ? 'Renombrarla actualiza la ruta de todas sus subcategorías.' : undefined}
        size="sm"
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
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Nombre" required error={error}>
            {(props) => (
              // eslint-disable-next-line jsx-a11y/no-autofocus -- dentro de un diálogo el foco ya está atrapado
              <Input {...props} autoFocus value={values.name} onChange={(e) => set('name', e.target.value)} />
            )}
          </Field>
          <Field label="Dentro de">
            {(props) => (
              <Select {...props} value={values.parentId} onChange={(e) => set('parentId', e.target.value)}>
                <option value="">Es una categoría raíz</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.path}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Descripción">
            {(props) => (
              <Textarea {...props} value={values.description} onChange={(e) => set('description', e.target.value)} />
            )}
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
