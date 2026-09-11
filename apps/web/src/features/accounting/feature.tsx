import {
  BookOpen,
  BookText,
  CalendarDays,
  Landmark,
  Plus,
  Scale,
  Settings2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { defineFeature } from '@/app/types';
import { ChartOfAccountsPage } from './pages/ChartOfAccountsPage';
import { JournalPage } from './pages/JournalPage';
import { EntryDetailPage } from './pages/EntryDetailPage';
import { ManualEntryPage } from './pages/ManualEntryPage';
import { PeriodsPage } from './pages/PeriodsPage';
import { TrialBalancePage } from './pages/TrialBalancePage';
import { IncomeStatementPage } from './pages/IncomeStatementPage';
import { BalanceSheetPage } from './pages/BalanceSheetPage';
import { LedgerPage } from './pages/LedgerPage';
import { AccountRolesPage } from './pages/AccountRolesPage';

export const accountingFeature = defineFeature({
  id: 'accounting',
  nav: [
    {
      label: 'Contabilidad',
      children: [
        {
          label: 'Libro diario',
          to: '/contabilidad/diario',
          icon: BookText,
          permission: 'accounting:entry:read',
        },
        {
          label: 'Libro mayor',
          to: '/contabilidad/mayor',
          icon: BookOpen,
          permission: 'accounting:report:read',
        },
        {
          label: 'Balance de prueba',
          to: '/contabilidad/balance-de-prueba',
          icon: Scale,
          permission: 'accounting:report:read',
        },
        {
          label: 'Estado de resultados',
          to: '/contabilidad/estado-de-resultados',
          icon: TrendingUp,
          permission: 'accounting:report:read',
        },
        {
          label: 'Balance general',
          to: '/contabilidad/balance-general',
          icon: Wallet,
          permission: 'accounting:report:read',
        },
        {
          label: 'Plan de cuentas',
          to: '/contabilidad/plan-de-cuentas',
          icon: Landmark,
          permission: 'accounting:account:read',
        },
        {
          label: 'Periodos',
          to: '/contabilidad/periodos',
          icon: CalendarDays,
          permission: 'accounting:period:read',
        },
      ],
    },
    // Se fusiona con el grupo de ajustes de los demás módulos: `mergeNav` une
    // los grupos por etiqueta para que no salga "Configuración" dos veces.
    {
      label: 'Configuración',
      children: [
        {
          label: 'Cuentas por operación',
          to: '/contabilidad/cuentas-por-operacion',
          icon: Settings2,
          permission: 'accounting:account:update',
        },
      ],
    },
  ],
  routes: [
    { path: 'contabilidad/diario', element: <JournalPage /> },
    // Antes que `asientos/:id`, o "nuevo" se interpretaría como un id.
    { path: 'contabilidad/asientos/nuevo', element: <ManualEntryPage /> },
    { path: 'contabilidad/asientos/:id', element: <EntryDetailPage /> },
    { path: 'contabilidad/mayor', element: <LedgerPage /> },
    { path: 'contabilidad/balance-de-prueba', element: <TrialBalancePage /> },
    { path: 'contabilidad/estado-de-resultados', element: <IncomeStatementPage /> },
    { path: 'contabilidad/balance-general', element: <BalanceSheetPage /> },
    { path: 'contabilidad/plan-de-cuentas', element: <ChartOfAccountsPage /> },
    { path: 'contabilidad/periodos', element: <PeriodsPage /> },
    { path: 'contabilidad/cuentas-por-operacion', element: <AccountRolesPage /> },
  ],
  commands: [
    {
      id: 'accounting.entry.new',
      label: 'Nuevo asiento manual',
      keywords: ['contabilizar', 'asiento', 'partida', 'doble'],
      icon: Plus,
      group: 'Contabilidad',
      permission: 'accounting:entry:create',
      run: (navigate) => navigate('/contabilidad/asientos/nuevo'),
    },
    {
      id: 'accounting.journal',
      label: 'Libro diario',
      keywords: ['asientos', 'contabilidad', 'movimientos'],
      icon: BookText,
      group: 'Contabilidad',
      permission: 'accounting:entry:read',
      run: (navigate) => navigate('/contabilidad/diario'),
    },
    {
      id: 'accounting.trial-balance',
      label: 'Balance de prueba',
      keywords: ['cuadre', 'sumas', 'saldos', 'comprobación'],
      icon: Scale,
      group: 'Contabilidad',
      permission: 'accounting:report:read',
      run: (navigate) => navigate('/contabilidad/balance-de-prueba'),
    },
    {
      id: 'accounting.income',
      label: 'Estado de resultados',
      keywords: ['pyg', 'utilidad', 'pérdidas', 'ganancias', 'resultado'],
      icon: TrendingUp,
      group: 'Contabilidad',
      permission: 'accounting:report:read',
      run: (navigate) => navigate('/contabilidad/estado-de-resultados'),
    },
    {
      id: 'accounting.balance-sheet',
      label: 'Balance general',
      keywords: ['activo', 'pasivo', 'patrimonio', 'situación'],
      icon: Wallet,
      group: 'Contabilidad',
      permission: 'accounting:report:read',
      run: (navigate) => navigate('/contabilidad/balance-general'),
    },
    {
      id: 'accounting.chart',
      label: 'Plan de cuentas',
      keywords: ['puc', 'cuentas', 'catálogo contable'],
      icon: Landmark,
      group: 'Contabilidad',
      permission: 'accounting:account:read',
      run: (navigate) => navigate('/contabilidad/plan-de-cuentas'),
    },
    {
      id: 'accounting.periods',
      label: 'Cerrar un periodo contable',
      keywords: ['cierre', 'mes', 'año', 'bloquear'],
      icon: CalendarDays,
      group: 'Contabilidad',
      permission: 'accounting:period:read',
      run: (navigate) => navigate('/contabilidad/periodos'),
    },
  ],
});
