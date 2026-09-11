import { Contact, Plus, Users } from 'lucide-react';
import { defineFeature } from '@/app/types';
import { PartiesPage } from './pages/PartiesPage';
import { PartyDetailPage } from './pages/PartyDetailPage';

export const crmFeature = defineFeature({
  id: 'crm',
  nav: [
    {
      label: 'Comercial',
      icon: Users,
      children: [
        { label: 'Clientes y proveedores', to: '/clientes', icon: Users, permission: 'crm:party:read' },
      ],
    },
  ],
  routes: [
    { path: 'clientes', element: <PartiesPage /> },
    { path: 'clientes/:id', element: <PartyDetailPage /> },
  ],
  commands: [
    {
      id: 'crm.parties',
      label: 'Ver clientes y proveedores',
      keywords: ['clientes', 'proveedores', 'terceros', 'cartera'],
      icon: Users,
      group: 'Comercial',
      permission: 'crm:party:read',
      run: (navigate) => navigate('/clientes'),
    },
    {
      id: 'crm.party.new',
      label: 'Nuevo cliente',
      keywords: ['crear', 'alta', 'ficha', 'tercero'],
      icon: Plus,
      group: 'Comercial',
      permission: 'crm:party:create',
      run: (navigate) => navigate('/clientes?nuevo=1'),
    },
    {
      id: 'crm.contacts',
      label: 'Buscar un contacto',
      keywords: ['personas', 'teléfono'],
      icon: Contact,
      group: 'Comercial',
      permission: 'crm:contact:read',
      run: (navigate) => navigate('/clientes'),
    },
  ],
});
