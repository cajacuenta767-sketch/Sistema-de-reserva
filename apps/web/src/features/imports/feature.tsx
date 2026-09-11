import { Upload } from 'lucide-react';
import { defineFeature } from '@/app/types';
import { ImportsPage } from './pages/ImportsPage';

export const importsFeature = defineFeature({
  id: 'imports',
  nav: [
    {
      label: 'Configuración',
      icon: Upload,
      children: [
        { label: 'Importaciones', to: '/importaciones', icon: Upload, permission: 'platform:import:read' },
      ],
    },
  ],
  routes: [{ path: 'importaciones', element: <ImportsPage /> }],
  commands: [
    {
      id: 'imports.new',
      label: 'Importar desde un archivo',
      keywords: ['csv', 'excel', 'masivo', 'cargar', 'subir'],
      icon: Upload,
      group: 'Configuración',
      permission: 'platform:import:create',
      run: (navigate) => navigate('/importaciones'),
    },
  ],
});
