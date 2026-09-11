import { LayoutDashboard } from 'lucide-react';
import { defineFeature } from '@/app/types';
import { DashboardPage } from './pages/DashboardPage';

export const dashboardFeature = defineFeature({
  id: 'dashboard',
  nav: [{ label: 'Escritorio', to: '/', icon: LayoutDashboard }],
  routes: [{ index: true, element: <DashboardPage /> }],
});
