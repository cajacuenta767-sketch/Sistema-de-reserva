import { FileText, PackageCheck, Plus, ShoppingCart, Wallet } from 'lucide-react';
import { defineFeature } from '@/app/types';
import { OrdersPage } from './pages/OrdersPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { OrderEditorPage } from './pages/OrderEditorPage';
import { ReceiptsPage } from './pages/ReceiptsPage';
import { ReceiptDetailPage } from './pages/ReceiptDetailPage';
import { BillsPage } from './pages/BillsPage';
import { BillDetailPage } from './pages/BillDetailPage';
import { BillEditorPage } from './pages/BillEditorPage';
import { PayablePage } from './pages/PayablePage';

export const purchasingFeature = defineFeature({
  id: 'purchasing',
  nav: [
    {
      label: 'Compras',
      children: [
        {
          label: 'Órdenes de compra',
          to: '/compras/ordenes',
          icon: ShoppingCart,
          permission: 'purchasing:order:read',
        },
        {
          label: 'Recepciones',
          to: '/compras/recepciones',
          icon: PackageCheck,
          permission: 'purchasing:receipt:read',
        },
        {
          label: 'Facturas de proveedor',
          to: '/compras/facturas',
          icon: FileText,
          permission: 'purchasing:bill:read',
        },
        {
          label: 'Cuentas por pagar',
          to: '/compras/por-pagar',
          icon: Wallet,
          permission: 'purchasing:bill:read',
        },
      ],
    },
  ],
  routes: [
    { path: 'compras/ordenes', element: <OrdersPage /> },
    // Antes que `ordenes/:id`, o "nueva" se interpretaría como un id.
    { path: 'compras/ordenes/nueva', element: <OrderEditorPage /> },
    { path: 'compras/ordenes/:id', element: <OrderDetailPage /> },
    { path: 'compras/ordenes/:id/editar', element: <OrderEditorPage /> },
    { path: 'compras/recepciones', element: <ReceiptsPage /> },
    { path: 'compras/recepciones/:id', element: <ReceiptDetailPage /> },
    { path: 'compras/facturas', element: <BillsPage /> },
    { path: 'compras/facturas/nueva', element: <BillEditorPage /> },
    { path: 'compras/facturas/:id', element: <BillDetailPage /> },
    { path: 'compras/por-pagar', element: <PayablePage /> },
  ],
  commands: [
    {
      id: 'purchasing.order.new',
      label: 'Nueva orden de compra',
      keywords: ['pedir', 'comprar', 'proveedor', 'pedido'],
      icon: Plus,
      group: 'Compras',
      permission: 'purchasing:order:create',
      run: (navigate) => navigate('/compras/ordenes/nueva'),
    },
    {
      id: 'purchasing.bill.new',
      label: 'Registrar factura de proveedor',
      keywords: ['cuenta por pagar', 'factura de compra', 'gasto'],
      icon: Plus,
      group: 'Compras',
      permission: 'purchasing:bill:create',
      run: (navigate) => navigate('/compras/facturas/nueva'),
    },
    {
      id: 'purchasing.orders',
      label: 'Ver órdenes de compra',
      keywords: ['pedidos', 'pendiente de llegar'],
      icon: ShoppingCart,
      group: 'Compras',
      permission: 'purchasing:order:read',
      run: (navigate) => navigate('/compras/ordenes'),
    },
    {
      id: 'purchasing.payable',
      label: 'Cuentas por pagar',
      keywords: ['deudas', 'proveedores', 'tesorería', 'vencido'],
      icon: Wallet,
      group: 'Compras',
      permission: 'purchasing:bill:read',
      run: (navigate) => navigate('/compras/por-pagar'),
    },
  ],
});
