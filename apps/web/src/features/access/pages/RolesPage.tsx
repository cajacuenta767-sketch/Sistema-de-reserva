import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Shield, Trash2 } from 'lucide-react';
import type { PermissionScope } from '@erp/contracts';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  PageHeader,
  PageLoader,
  Select,
  Textarea,
  cx,
} from '@/design-system';
import { del, get, post, put } from '@/lib/api/client';
import { useCollection } from '@/lib/api/useList';
import { Can, useCan } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';

interface Role {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
}

interface PermissionDef {
  key: string;
  module: string;
  resource: string;
  action: string;
  label: string;
  description?: string;
  scopes: PermissionScope[];
  sensitive?: boolean;
}

interface Grant {
  key: string;
  scope: PermissionScope;
}

const SCOPE_LABEL: Record<PermissionScope, string> = {
  OWN: 'Solo lo suyo',
  TEAM: 'Su equipo',
  BRANCH: 'Su sucursal',
  ORG: 'Toda la empresa',
};

const MODULE_LABEL: Record<string, string> = {
  identity: 'Personas y accesos',
  org: 'Empresa',
};

export function RolesPage() {
  const roles = useCollection<Role>('/roles');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const can = useCan();

  const items = roles.data?.items ?? [];
  const current = selectedId ?? items[0]?.id ?? null;

  return (
    <>
      <PageHeader
        title="Roles y permisos"
        description="Qué puede hacer cada rol, y hasta dónde alcanza"
        actions={
          <Can perm="identity:role:create">
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nuevo rol
            </Button>
          </Can>
        }
      />

      {roles.isLoading ? (
        <PageLoader />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <nav className="card h-fit p-1.5" aria-label="Roles">
            {items.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => setSelectedId(role.id)}
                className={cx(
                  'flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left text-sm transition-colors',
                  role.id === current ? 'bg-accent text-fg-on-accent' : 'text-fg hover:bg-surface-2',
                )}
              >
                <Shield className="size-4 shrink-0 opacity-70" />
                <span className="flex-1 truncate">{role.name}</span>
                <span className={cx('text-xs', role.id === current ? 'opacity-80' : 'text-fg-subtle')}>
                  {role.memberCount}
                </span>
              </button>
            ))}
          </nav>

          {current ? (
            <RoleEditor
              roleId={current}
              readOnly={!can('identity:role:update')}
              onDeleted={() => setSelectedId(null)}
            />
          ) : (
            <div className="card p-8 text-center text-sm text-fg-muted">No hay roles todavía.</div>
          )}
        </div>
      )}

      <CreateRoleDialog open={creating} onOpenChange={setCreating} onCreated={(id) => setSelectedId(id)} />
    </>
  );
}

function RoleEditor({
  roleId,
  readOnly,
  onDeleted,
}: {
  roleId: string;
  readOnly: boolean;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const role = useQuery({
    queryKey: [`/roles/${roleId}`],
    queryFn: () => get<{ role: Role; permissions: Grant[] }>(`/roles/${roleId}`),
  });
  const catalog = useCollection<{ module: string; permissions: PermissionDef[] }>('/roles/catalog', {
    staleTime: 5 * 60_000,
  });

  const [draft, setDraft] = useState<Map<string, PermissionScope> | null>(null);

  // El borrador se inicializa desde el servidor la primera vez que llegan datos,
  // y se descarta al cambiar de rol.
  const grants = useMemo(() => {
    if (draft) return draft;
    return new Map((role.data?.permissions ?? []).map((g) => [g.key, g.scope]));
  }, [draft, role.data]);

  const save = useMutation({
    mutationFn: () =>
      put(`/roles/${roleId}/permissions`, {
        permissions: [...grants].map(([key, scope]) => ({ key, scope })),
      }),
    onSuccess: () => {
      toast.success('Permisos guardados');
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: [`/roles/${roleId}`] });
      void queryClient.invalidateQueries({ queryKey: ['/auth/session'] });
    },
    onError: toast.error,
  });

  const remove = useMutation({
    mutationFn: () => del(`/roles/${roleId}`),
    onSuccess: () => {
      toast.success('Rol eliminado');
      onDeleted();
      void queryClient.invalidateQueries({ queryKey: ['/roles'] });
    },
    onError: toast.error,
  });

  if (role.isLoading || catalog.isLoading)
    return (
      <div className="card p-8">
        <PageLoader />
      </div>
    );
  if (!role.data) return null;

  const toggle = (key: string, defaultScope: PermissionScope) => {
    const next = new Map(grants);
    if (next.has(key)) next.delete(key);
    else next.set(key, defaultScope);
    setDraft(next);
  };

  const setScope = (key: string, scope: PermissionScope) => {
    const next = new Map(grants);
    next.set(key, scope);
    setDraft(next);
  };

  const toggleModule = (permissions: PermissionDef[], enable: boolean) => {
    const next = new Map(grants);
    for (const p of permissions) {
      if (enable) next.set(p.key, p.scopes.at(-1) ?? 'ORG');
      else next.delete(p.key);
    }
    setDraft(next);
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-1 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-fg">{role.data.role.name}</h2>
          {role.data.role.isSystem && <Badge tone="info">Del sistema</Badge>}
          <span className="ml-auto text-xs text-fg-subtle">{grants.size} permiso(s) concedido(s)</span>
        </div>
        {role.data.role.description && <p className="text-sm text-fg-muted">{role.data.role.description}</p>}
      </div>

      {catalog.data?.items.map(({ module, permissions }) => {
        const allOn = permissions.every((p) => grants.has(p.key));
        return (
          <section key={module} className="card overflow-hidden">
            <header className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-2.5">
              <h3 className="text-sm font-medium text-fg">{MODULE_LABEL[module] ?? module}</h3>
              {!readOnly && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => toggleModule(permissions, !allOn)}
                >
                  {allOn ? 'Quitar todos' : 'Conceder todos'}
                </Button>
              )}
            </header>

            <ul className="divide-y divide-border">
              {permissions.map((permission) => {
                const scope = grants.get(permission.key);
                const granted = scope !== undefined;
                return (
                  <li key={permission.key} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <input
                      type="checkbox"
                      id={permission.key}
                      checked={granted}
                      disabled={readOnly}
                      onChange={() => toggle(permission.key, permission.scopes.at(-1) ?? 'ORG')}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    <label htmlFor={permission.key} className="min-w-0 flex-1 cursor-pointer">
                      <span className="flex items-center gap-2 text-sm text-fg">
                        {permission.label}
                        {permission.sensitive && <Badge tone="warning">Sensible</Badge>}
                      </span>
                      <span className="block font-mono text-[11px] text-fg-subtle">{permission.key}</span>
                    </label>

                    {/* El alcance solo tiene sentido si el permiso admite varios. */}
                    {granted && permission.scopes.length > 1 && (
                      <Select
                        value={scope}
                        disabled={readOnly}
                        onChange={(e) => setScope(permission.key, e.target.value as PermissionScope)}
                        className="h-8 w-auto text-xs"
                        aria-label={`Alcance de ${permission.label}`}
                      >
                        {permission.scopes.map((s) => (
                          <option key={s} value={s}>
                            {SCOPE_LABEL[s]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {!readOnly && (
        <div className="sticky bottom-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 shadow-lg">
          {draft && <span className="text-sm text-fg-muted">Hay cambios sin guardar</span>}
          <div className="ml-auto flex gap-2">
            {!role.data.role.isSystem && (
              <Button
                variant="ghost"
                icon={<Trash2 className="size-4" />}
                onClick={() => remove.mutate()}
                loading={remove.isPending}
              >
                Eliminar rol
              </Button>
            )}
            {draft && <Button onClick={() => setDraft(null)}>Descartar</Button>}
            <Button
              variant="primary"
              disabled={!draft}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              Guardar permisos
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateRoleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () => post<Role>('/roles', { name, description: description || null }),
    onSuccess: (role) => {
      toast.success('Rol creado');
      void queryClient.invalidateQueries({ queryKey: ['/roles'] });
      onCreated(role.id);
      onOpenChange(false);
      setName('');
      setDescription('');
    },
    onError: toast.error,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Nuevo rol"
        description="Empieza sin permisos y concédelos uno a uno."
        size="sm"
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              Crear
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Nombre" required>
            {(props) => <Input {...props} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Descripción">
            {(props) => (
              <Textarea {...props} value={description} onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
