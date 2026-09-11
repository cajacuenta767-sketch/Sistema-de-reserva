import { definePermission } from '@erp/contracts';
import { defineModule } from '../../platform/modules/types.js';
import { OrganizationUseCases } from './application/use-cases/OrganizationUseCases.js';
import {
  PgBranchRepository,
  PgOrganizationRepository,
  PgSettingsRepository,
} from './infrastructure/persistence/PgOrganizationRepository.js';
import { organizationRoutes } from './infrastructure/http/organization.routes.js';

export const organizationModule = defineModule({
  id: 'organization',

  permissions: [
    definePermission('org:organization:read', 'Ver los datos de la empresa'),
    definePermission('org:organization:update', 'Editar los datos de la empresa', { sensitive: true }),
    definePermission('org:branch:read', 'Ver sucursales'),
    definePermission('org:branch:create', 'Crear sucursales'),
    definePermission('org:branch:update', 'Editar sucursales'),
    definePermission('org:branch:delete', 'Eliminar sucursales', { sensitive: true }),
    definePermission('org:settings:read', 'Ver la configuración'),
    definePermission('org:settings:update', 'Cambiar la configuración', { sensitive: true }),
  ],

  register(ctx) {
    return new OrganizationUseCases(
      new PgOrganizationRepository(),
      new PgBranchRepository(),
      new PgSettingsRepository(),
      ctx.audit,
      ctx.clock,
    );
  },

  routes: organizationRoutes,
});

export type OrganizationApi = OrganizationUseCases;
