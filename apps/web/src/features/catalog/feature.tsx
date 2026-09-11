import { FolderTree, Package, Percent, Plus, Ruler, Tags } from 'lucide-react';
import { defineFeature } from '@/app/types';
import { ProductsPage } from './pages/ProductsPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { TaxesPage } from './pages/TaxesPage';
import { UomsPage } from './pages/UomsPage';
import { PriceListsPage } from './pages/PriceListsPage';

export const catalogFeature = defineFeature({
  id: 'catalog',
  nav: [
    {
      label: 'Catálogo',
      icon: Package,
      children: [
        { label: 'Productos y servicios', to: '/productos', icon: Package, permission: 'catalog:product:read' },
        { label: 'Categorías', to: '/categorias', icon: FolderTree, permission: 'catalog:product:read' },
        { label: 'Listas de precios', to: '/listas-de-precios', icon: Tags, permission: 'catalog:pricelist:read' },
        { label: 'Impuestos', to: '/impuestos', icon: Percent, permission: 'catalog:tax:read' },
        { label: 'Unidades de medida', to: '/unidades', icon: Ruler, permission: 'catalog:uom:read' },
      ],
    },
  ],
  routes: [
    { path: 'productos', element: <ProductsPage /> },
    { path: 'productos/:id', element: <ProductDetailPage /> },
    { path: 'categorias', element: <CategoriesPage /> },
    { path: 'listas-de-precios', element: <PriceListsPage /> },
    { path: 'impuestos', element: <TaxesPage /> },
    { path: 'unidades', element: <UomsPage /> },
  ],
  commands: [
    {
      id: 'catalog.products',
      label: 'Ver productos',
      keywords: ['catálogo', 'artículos', 'servicios', 'referencias'],
      icon: Package,
      group: 'Catálogo',
      permission: 'catalog:product:read',
      run: (navigate) => navigate('/productos'),
    },
    {
      id: 'catalog.product.new',
      label: 'Nuevo producto',
      keywords: ['crear', 'alta', 'artículo', 'referencia'],
      icon: Plus,
      group: 'Catálogo',
      permission: 'catalog:product:create',
      run: (navigate) => navigate('/productos?nuevo=1'),
    },
    {
      id: 'catalog.prices',
      label: 'Listas de precios',
      keywords: ['precios', 'descuentos', 'tarifas', 'mayorista'],
      icon: Tags,
      group: 'Catálogo',
      permission: 'catalog:pricelist:read',
      run: (navigate) => navigate('/listas-de-precios'),
    },
    {
      id: 'catalog.taxes',
      label: 'Impuestos',
      keywords: ['iva', 'retefuente', 'reteica', 'inc', 'dian'],
      icon: Percent,
      group: 'Catálogo',
      permission: 'catalog:tax:read',
      run: (navigate) => navigate('/impuestos'),
    },
    {
      id: 'catalog.uoms',
      label: 'Unidades de medida',
      keywords: ['unidades', 'kilos', 'cajas', 'conversión'],
      icon: Ruler,
      group: 'Catálogo',
      permission: 'catalog:uom:read',
      run: (navigate) => navigate('/unidades'),
    },
  ],
});
