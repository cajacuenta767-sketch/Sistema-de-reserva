import { Boxes, BookOpen, ClipboardList, Plus, Warehouse } from 'lucide-react';
import { defineFeature } from '@/app/types';
import { StockPage } from './pages/StockPage';
import { KardexPage } from './pages/KardexPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { CountsPage } from './pages/CountsPage';
import { CountDetailPage } from './pages/CountDetailPage';

export const inventoryFeature = defineFeature({
  id: 'inventory',
  nav: [
    {
      label: 'Inventario',
      children: [
        {
          label: 'Existencias',
          to: '/inventario/existencias',
          icon: Boxes,
          permission: 'inventory:stock:read',
        },
        { label: 'Kardex', to: '/inventario/kardex', icon: BookOpen, permission: 'inventory:move:read' },
        {
          label: 'Conteos',
          to: '/inventario/conteos',
          icon: ClipboardList,
          permission: 'inventory:count:read',
        },
        {
          label: 'Bodegas',
          to: '/inventario/bodegas',
          icon: Warehouse,
          permission: 'inventory:warehouse:read',
        },
      ],
    },
  ],
  routes: [
    { path: 'inventario/existencias', element: <StockPage /> },
    { path: 'inventario/kardex', element: <KardexPage /> },
    { path: 'inventario/conteos', element: <CountsPage /> },
    { path: 'inventario/conteos/:id', element: <CountDetailPage /> },
    { path: 'inventario/bodegas', element: <WarehousesPage /> },
  ],
  commands: [
    {
      id: 'inventory.stock',
      label: 'Ver existencias',
      keywords: ['stock', 'inventario', 'bodega', 'disponible'],
      icon: Boxes,
      group: 'Inventario',
      permission: 'inventory:stock:read',
      run: (navigate) => navigate('/inventario/existencias'),
    },
    {
      id: 'inventory.kardex',
      label: 'Kardex de un producto',
      keywords: ['movimientos', 'entradas', 'salidas', 'costo'],
      icon: BookOpen,
      group: 'Inventario',
      permission: 'inventory:move:read',
      run: (navigate) => navigate('/inventario/kardex'),
    },
    {
      id: 'inventory.count',
      label: 'Abrir un conteo físico',
      keywords: ['contar', 'cuadrar', 'ajuste', 'toma física'],
      icon: Plus,
      group: 'Inventario',
      permission: 'inventory:count:create',
      run: (navigate) => navigate('/inventario/conteos'),
    },
  ],
});
