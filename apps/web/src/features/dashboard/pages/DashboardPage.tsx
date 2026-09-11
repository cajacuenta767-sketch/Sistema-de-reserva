import { Building2, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Button, PageHeader, ProgressCard, StatTile } from '@/design-system';
import { useCollection, useList } from '@/lib/api/useList';
import { useAuth, useOrganization } from '@/store/auth';
import { Can } from '@/lib/authz/useCan';
import { relative } from '@/lib/format';

interface MemberRow {
  membership_id: string;
  full_name: string;
  roles: string[];
  status: string;
  last_login_at: string | null;
}

/**
 * Escritorio.
 *
 * De momento compone los widgets del módulo de accesos, que es lo único que
 * existe. A partir de la Fase 1 cada módulo publicará los suyos y esta página
 * solo los ordenará: no crece con el sistema.
 */
export function DashboardPage() {
  const { session } = useAuth();
  const organization = useOrganization();

  const members = useList<MemberRow>('/members', new URLSearchParams({ pageSize: '5', sort: '-created_at' }));
  const roles = useCollection<{ id: string; name: string; memberCount: number }>('/roles');

  const active = Number(members.data?.aggregates?.active ?? 0);
  const total = members.data?.total ?? 0;
  const firstName = session?.user.firstName ?? '';

  return (
    <>
      <PageHeader
        title={`Hola, ${firstName}`}
        description={organization ? `Estás en ${organization.tradeName}` : undefined}
        actions={
          <Can perm="identity:invitation:create">
            <Button variant="primary" icon={<UserPlus className="size-4" />} asChild>
              <Link to="/personas">Invitar a alguien</Link>
            </Button>
          </Can>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Personas" value={total} icon={<Users className="size-5" />} />
        <StatTile label="Activas" value={active} tone="success" icon={<Users className="size-5" />} />
        <StatTile
          label="Roles"
          value={roles.data?.items.length ?? '—'}
          tone="info"
          icon={<ShieldCheck className="size-5" />}
        />
        <StatTile
          label="Tus permisos"
          value={Object.keys(session?.permissions ?? {}).length}
          tone="accent"
          icon={<Building2 className="size-5" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium text-fg">Últimas personas</h2>
            <Button variant="link" size="sm" asChild>
              <Link to="/personas">Ver todas</Link>
            </Button>
          </header>
          <ul className="divide-y divide-border">
            {(members.data?.items ?? []).map((member) => (
              <li key={member.membership_id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{member.full_name}</p>
                  <p className="truncate text-xs text-fg-subtle">{member.roles.join(' · ') || 'Sin rol'}</p>
                </div>
                <span className="shrink-0 text-xs text-fg-subtle">
                  {member.last_login_at ? relative(member.last_login_at) : 'Nunca entró'}
                </span>
              </li>
            ))}
            {members.data?.items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-fg-muted">Todavía no hay nadie.</li>
            )}
          </ul>
        </section>

        <div className="space-y-3">
          <ProgressCard label="Personas activas" value={active} total={total || 1} tone="success" />
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-medium text-fg">Tus roles</h2>
            <div className="flex flex-wrap gap-1.5">
              {(session?.roles ?? []).map((role) => (
                <Badge key={role.id} tone="accent">
                  {role.name}
                </Badge>
              ))}
              {session?.roles.length === 0 && <p className="text-sm text-fg-muted">Sin rol asignado.</p>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
