import { Building2, Settings } from 'lucide-react';
import { defineFeature } from '@/app/types';
import { OrganizationPage } from './pages/OrganizationPage';

export const settingsFeature = defineFeature({
  id: 'settings',
  nav: [
    {
      label: 'Configuración',
      icon: Settings,
      children: [{ label: 'Empresa', to: '/empresa', icon: Building2, permission: 'org:organization:read' }],
    },
  ],
  routes: [{ path: 'empresa', element: <OrganizationPage /> }],
  commands: [
    {
      id: 'settings.organization',
      label: 'Datos de la empresa',
      keywords: ['nit', 'marca', 'color', 'razón social'],
      icon: Building2,
      group: 'Configuración',
      permission: 'org:organization:read',
      run: (navigate) => navigate('/empresa'),
    },
  ],
});
