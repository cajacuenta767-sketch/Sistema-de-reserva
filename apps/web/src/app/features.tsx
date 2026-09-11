import { dashboardFeature } from '@/features/dashboard/feature';
import { crmFeature } from '@/features/crm/feature';
import { salesFeature } from '@/features/sales/feature';
import { catalogFeature } from '@/features/catalog/feature';
import { accountingFeature } from '@/features/accounting/feature';
import { importsFeature } from '@/features/imports/feature';
import { accessFeature } from '@/features/access/feature';
import { settingsFeature } from '@/features/settings/feature';
import type { FeatureModule } from './types';

/**
 * LA ÚNICA LISTA QUE CRECE en el frontend.
 *
 * El orden define el del menú lateral. Cada módulo trae consigo sus rutas, su
 * navegación, sus comandos y sus widgets, así que ni el shell ni el router
 * cambian al añadir uno.
 */
export const features: FeatureModule[] = [
  dashboardFeature,
  crmFeature,
  salesFeature,
  catalogFeature,
  accountingFeature,
  importsFeature,
  accessFeature,
  settingsFeature,
];
