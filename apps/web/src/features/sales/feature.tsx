import { FileSignature, FileText, Plus, TrendingDown, Wallet } from 'lucide-react';
import { defineFeature } from '@/app/types';
import { QuotesPage } from './pages/QuotesPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { InvoiceEditorPage } from './pages/InvoiceEditorPage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { AgingPage } from './pages/AgingPage';

export const salesFeature = defineFeature({
  id: 'sales',
  nav: [
    {
      label: 'Comercial',
      children: [
        { label: 'Cotizaciones', to: '/cotizaciones', icon: FileSignature, permission: 'sales:quote:read' },
        { label: 'Facturas', to: '/facturas', icon: FileText, permission: 'sales:invoice:read' },
        { label: 'Cobros', to: '/cobros', icon: Wallet, permission: 'sales:payment:read' },
        { label: 'Cartera', to: '/cartera', icon: TrendingDown, permission: 'sales:invoice:read' },
      ],
    },
  ],
  routes: [
    { path: 'cotizaciones', element: <QuotesPage /> },
    { path: 'facturas', element: <InvoicesPage /> },
    // Antes que `facturas/:id`, o "nueva" se interpretaría como un id.
    { path: 'facturas/nueva', element: <InvoiceEditorPage /> },
    { path: 'facturas/:id', element: <InvoiceDetailPage /> },
    { path: 'facturas/:id/editar', element: <InvoiceEditorPage /> },
    { path: 'cobros', element: <PaymentsPage /> },
    { path: 'cartera', element: <AgingPage /> },
  ],
  commands: [
    {
      id: 'sales.invoice.new',
      label: 'Nueva factura',
      keywords: ['facturar', 'cobrar', 'venta', 'crear'],
      icon: Plus,
      group: 'Comercial',
      permission: 'sales:invoice:create',
      run: (navigate) => navigate('/facturas/nueva'),
    },
    {
      id: 'sales.invoices',
      label: 'Ver facturas',
      keywords: ['ventas', 'facturación'],
      icon: FileText,
      group: 'Comercial',
      permission: 'sales:invoice:read',
      run: (navigate) => navigate('/facturas'),
    },
    {
      id: 'sales.quotes',
      label: 'Ver cotizaciones',
      keywords: ['ofertas', 'presupuestos', 'propuestas'],
      icon: FileSignature,
      group: 'Comercial',
      permission: 'sales:quote:read',
      run: (navigate) => navigate('/cotizaciones'),
    },
    {
      id: 'sales.payments',
      label: 'Registrar un cobro',
      keywords: ['pago', 'recibo', 'abono', 'transferencia'],
      icon: Wallet,
      group: 'Comercial',
      permission: 'sales:payment:create',
      run: (navigate) => navigate('/cobros'),
    },
    {
      id: 'sales.aging',
      label: 'Cartera por edades',
      keywords: ['vencido', 'mora', 'deudas', 'cobranza'],
      icon: TrendingDown,
      group: 'Comercial',
      permission: 'sales:invoice:read',
      run: (navigate) => navigate('/cartera'),
    },
  ],
});
