import { History, Shield, UserPlus, Users } from 'lucide-react';
import { defineFeature } from '@/app/types';
import { MembersPage } from './pages/MembersPage';
import { RolesPage } from './pages/RolesPage';
import { AuditPage } from './pages/AuditPage';

export const accessFeature = defineFeature({
  id: 'access',
  nav: [
    {
      label: 'Accesos',
      icon: Users,
      children: [
        { label: 'Personas', to: '/personas', icon: Users, permission: 'identity:member:read' },
        { label: 'Roles y permisos', to: '/roles', icon: Shield, permission: 'identity:role:read' },
        { label: 'Auditoría', to: '/auditoria', icon: History, permission: 'identity:audit:read' },
      ],
    },
  ],
  routes: [
    { path: 'personas', element: <MembersPage /> },
    { path: 'roles', element: <RolesPage /> },
    { path: 'auditoria', element: <AuditPage /> },
  ],
  commands: [
    {
      id: 'access.members',
      label: 'Ver personas',
      keywords: ['usuarios', 'equipo', 'miembros'],
      icon: Users,
      group: 'Accesos',
      permission: 'identity:member:read',
      run: (navigate) => navigate('/personas'),
    },
    {
      id: 'access.invite',
      label: 'Invitar a alguien',
      keywords: ['nuevo', 'usuario', 'alta'],
      icon: UserPlus,
      group: 'Accesos',
      permission: 'identity:invitation:create',
      run: (navigate) => navigate('/personas'),
    },
    {
      id: 'access.roles',
      label: 'Editar roles y permisos',
      keywords: ['permisos', 'seguridad'],
      icon: Shield,
      group: 'Accesos',
      permission: 'identity:role:read',
      run: (navigate) => navigate('/roles'),
    },
    {
      id: 'access.audit',
      label: 'Ver auditoría',
      keywords: ['historial', 'cambios', 'log'],
      icon: History,
      group: 'Accesos',
      permission: 'identity:audit:read',
      run: (navigate) => navigate('/auditoria'),
    },
  ],
});
