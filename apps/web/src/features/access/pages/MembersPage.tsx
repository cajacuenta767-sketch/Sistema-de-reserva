import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Shield, UserPlus, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  Field,
  Input,
  PageHeader,
  Select,
  StatTile,
} from '@/design-system';
import { DataTable, type Column } from '@/design-system/data/DataTable';
import { useTableState } from '@/lib/url/useTableState';
import { useCollection, useList } from '@/lib/api/useList';
import { patch, post, put } from '@/lib/api/client';
import { useCan, Can } from '@/lib/authz/useCan';
import { useToast } from '@/store/toast';
import { relative } from '@/lib/format';

interface MemberRow {
  membership_id: string;
  user_id: string;
  email: string;
  full_name: string;
  job_title: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  is_owner: boolean;
  roles: string[];
  last_login_at: string | null;
  created_at: string;
}

interface Role {
  id: string;
  name: string;
  code: string | null;
  isSystem: boolean;
  memberCount: number;
}

const STATUS_TONE = { ACTIVE: 'success', SUSPENDED: 'warning', REMOVED: 'neutral' } as const;
const STATUS_LABEL = { ACTIVE: 'Activo', SUSPENDED: 'Suspendido', REMOVED: 'Retirado' };

export function MembersPage() {
  const table = useTableState({ defaultSort: [{ field: 'full_name', dir: 'asc' }] });
  const can = useCan();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useList<MemberRow>('/members', table.toQuery());
  const roles = useCollection<Role>('/roles');
  const [inviting, setInviting] = useState(false);
  const [editingRoles, setEditingRoles] = useState<MemberRow | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['/members'] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MemberRow['status'] }) =>
      patch(`/members/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Estado actualizado');
      invalidate();
    },
    onError: toast.error,
  });

  const columns = useMemo<Column<MemberRow>[]>(
    () => [
      {
        id: 'full_name',
        header: 'Persona',
        primary: true,
        sortable: true,
        cell: (row) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.full_name}</span>
            {row.is_owner && <Badge tone="accent">Propietario</Badge>}
          </div>
        ),
      },
      { id: 'email', header: 'Correo', sortable: true, cell: (row) => row.email },
      { id: 'job_title', header: 'Cargo', sortable: true, cell: (row) => row.job_title ?? '—' },
      {
        id: 'roles',
        header: 'Roles',
        sortable: false,
        cell: (row) =>
          row.roles.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.roles.map((name) => (
                <Badge key={name}>{name}</Badge>
              ))}
            </div>
          ) : (
            <span className="text-fg-subtle">Sin rol</span>
          ),
      },
      {
        id: 'status',
        header: 'Estado',
        sortable: true,
        cell: (row) => (
          <Badge tone={STATUS_TONE[row.status]} dot>
            {STATUS_LABEL[row.status]}
          </Badge>
        ),
      },
      {
        id: 'last_login_at',
        header: 'Último acceso',
        sortable: true,
        hiddenByDefault: true,
        cell: (row) => (row.last_login_at ? relative(row.last_login_at) : 'Nunca'),
      },
      {
        id: 'created_at',
        header: 'Se unió',
        sortable: true,
        hiddenByDefault: true,
        cell: (row) => relative(row.created_at),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        title="Personas"
        description="Quién tiene acceso y qué puede hacer"
        actions={
          <Can perm="identity:invitation:create">
            <Button
              variant="primary"
              icon={<UserPlus className="size-4" />}
              onClick={() => setInviting(true)}
            >
              Invitar
            </Button>
          </Can>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Personas activas"
          value={query.data?.aggregates?.active ?? '—'}
          icon={<Users className="size-5" />}
        />
        <StatTile
          label="Suspendidas"
          value={query.data?.aggregates?.suspended ?? '—'}
          tone="warning"
          icon={<Ban className="size-5" />}
        />
        <StatTile
          label="Roles definidos"
          value={roles.data?.items.length ?? '—'}
          tone="info"
          icon={<Shield className="size-5" />}
        />
        <StatTile
          label="Total"
          value={query.data?.total ?? '—'}
          tone="accent"
          icon={<Users className="size-5" />}
        />
      </div>

      <DataTable
        columns={columns}
        data={query.data}
        state={table.state}
        onStateChange={table.update}
        onToggleSort={table.toggleSort}
        rowId={(row) => row.membership_id}
        loading={query.isFetching}
        error={query.error as Error | null}
        onRefresh={() => void query.refetch()}
        can={can}
        searchPlaceholder="Buscar por nombre, correo o cargo…"
        emptyTitle="No hay nadie todavía"
        emptyDescription="Invita a alguien para que empiece a trabajar contigo."
        filters={
          <Select
            value={(table.state.filters.find((f) => f.field === 'status')?.value as string | undefined) ?? ''}
            onChange={(e) => table.setFilter('status', 'eq', e.target.value || null)}
            className="h-9 w-auto"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            <option value="ACTIVE">Activos</option>
            <option value="SUSPENDED">Suspendidos</option>
            <option value="REMOVED">Retirados</option>
          </Select>
        }
        rowActions={[
          {
            label: 'Cambiar roles',
            icon: <Shield className="size-4" />,
            hidden: () => !can('identity:member:assign_roles'),
            onRun: (row) => setEditingRoles(row),
          },
          {
            label: 'Suspender',
            icon: <Ban className="size-4" />,
            destructive: true,
            hidden: (row) => row.is_owner || row.status !== 'ACTIVE' || !can('identity:member:update'),
            onRun: (row) => setStatus.mutate({ id: row.membership_id, status: 'SUSPENDED' }),
          },
          {
            label: 'Reactivar',
            icon: <CheckCircle2 className="size-4" />,
            hidden: (row) => row.status === 'ACTIVE' || !can('identity:member:update'),
            onRun: (row) => setStatus.mutate({ id: row.membership_id, status: 'ACTIVE' }),
          },
        ]}
      />

      <InviteDialog open={inviting} onOpenChange={setInviting} roles={roles.data?.items ?? []} />
      {editingRoles && (
        <MemberRolesDialog
          member={editingRoles}
          roles={roles.data?.items ?? []}
          onClose={() => setEditingRoles(null)}
          onSaved={invalidate}
        />
      )}
    </>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  roles: Role[];
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [token, setToken] = useState<string>();

  const invite = useMutation({
    mutationFn: () =>
      post<{ id: string; token: string }>('/invitations', { email, roleIds: roleId ? [roleId] : [] }),
    onSuccess: (result) => {
      setToken(result.token);
      toast.success('Invitación enviada');
    },
    onError: toast.error,
  });

  const close = () => {
    onOpenChange(false);
    setToken(undefined);
    setEmail('');
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent
        title="Invitar a alguien"
        description="Recibirá un correo con el enlace para unirse."
        size="sm"
        footer={
          token ? (
            <Button variant="primary" onClick={close}>
              Listo
            </Button>
          ) : (
            <>
              <Button onClick={close}>Cancelar</Button>
              <Button variant="primary" loading={invite.isPending} onClick={() => invite.mutate()}>
                Enviar invitación
              </Button>
            </>
          )
        }
      >
        {token ? (
          <div className="space-y-3">
            <p className="text-sm text-fg-muted">
              En desarrollo no hay servidor de correo, así que este es el código de la invitación:
            </p>
            <code className="block rounded-[var(--radius-control)] bg-surface-2 p-3 font-mono text-xs break-all">
              {token}
            </code>
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Correo" required>
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            <Field label="Rol" hint="Puedes cambiarlo después">
              {(props) => (
                <Select {...props} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                  <option value="">Sin rol</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberRolesDialog({
  member,
  roles,
  onClose,
  onSaved,
}: {
  member: MemberRow;
  roles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(roles.filter((r) => member.roles.includes(r.name)).map((r) => r.id)),
  );

  const save = useMutation({
    mutationFn: () => put(`/members/${member.membership_id}/roles`, { roleIds: [...selected] }),
    onSuccess: () => {
      toast.success('Roles actualizados');
      onSaved();
      onClose();
    },
    onError: toast.error,
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        title={`Roles de ${member.full_name}`}
        description="Los permisos son la unión de todos sus roles."
        size="sm"
        footer={
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Guardar
            </Button>
          </>
        }
      >
        <div className="space-y-1">
          {roles.map((role) => (
            <label
              key={role.id}
              className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-2 py-2 hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={selected.has(role.id)}
                onChange={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(role.id)) next.delete(role.id);
                    else next.add(role.id);
                    return next;
                  })
                }
                className="size-4 accent-[var(--color-accent)]"
              />
              <span className="flex-1 text-sm text-fg">{role.name}</span>
              <span className="text-xs text-fg-subtle">{role.memberCount} persona(s)</span>
            </label>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
