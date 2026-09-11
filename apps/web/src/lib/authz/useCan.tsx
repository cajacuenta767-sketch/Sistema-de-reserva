import type { ReactNode } from 'react';
import { useAuth } from '@/store/auth';
import { Tooltip } from '@/design-system';

/**
 * Comprobación de permisos en el frontend.
 *
 * El frontend NUNCA es la autoridad: el backend rechaza con 403 pase lo que
 * pase aquí. Esto solo evita enseñar botones que fallarían al pulsarlos.
 */
export function useCan() {
  const { permissions } = useAuth();

  return (key: string, record?: { ownerMembershipId?: string | null }): boolean => {
    if (!permissions.can(key)) return false;
    const scope = permissions.scopeOf(key);
    // Con alcance OWN solo se puede actuar sobre lo propio; el resto de alcances
    // dependen de datos que el servidor conoce mejor, así que se dejan pasar y
    // es él quien decide.
    if (scope === 'OWN' && record?.ownerMembershipId !== undefined) {
      return record.ownerMembershipId !== null;
    }
    return true;
  };
}

export interface CanProps {
  perm: string | string[];
  children: ReactNode;
  /**
   * `hide` (por defecto) para lo que el usuario nunca podrá usar: módulos,
   * menús, pestañas. `disable` para lo que sí está en su flujo pero le está
   * vedado ahora: así aprende que la función existe y a quién pedírsela.
   */
  mode?: 'hide' | 'disable';
  reason?: string;
  fallback?: ReactNode;
}

export function Can({ perm, children, mode = 'hide', reason, fallback = null }: CanProps) {
  const can = useCan();
  const keys = Array.isArray(perm) ? perm : [perm];
  const allowed = keys.some((k) => can(k));

  if (allowed) return <>{children}</>;
  if (mode === 'hide') return <>{fallback}</>;

  return (
    <Tooltip content={reason ?? `Necesitas el permiso ${keys[0]}`}>
      <span className="inline-flex cursor-not-allowed opacity-50 [&>*]:pointer-events-none">{children}</span>
    </Tooltip>
  );
}
