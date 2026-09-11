import { crudPermissions, definePermission } from '@erp/contracts';
import { defineModule } from '../../platform/modules/types.js';
import { PartyUseCases } from './application/use-cases/PartyUseCases.js';
import { CrmUseCases } from './application/use-cases/CrmUseCases.js';
import { PgAddressRepository, PgPartyRepository } from './infrastructure/persistence/PgPartyRepository.js';
import {
  PgActivityRepository,
  PgContactRepository,
  PgProfileRepository,
  PgTagRepository,
} from './infrastructure/persistence/PgCrmRepositories.js';
import { crmRoutes } from './infrastructure/http/crm.routes.js';

export const crmModule = defineModule({
  id: 'crm',

  permissions: [
    // Clientes y proveedores son la misma entidad: un solo juego de permisos.
    ...crudPermissions('crm', 'party', 'clientes y proveedores', ['OWN', 'TEAM', 'BRANCH', 'ORG']),
    ...crudPermissions('crm', 'contact', 'contactos', ['OWN', 'TEAM', 'BRANCH', 'ORG']),
    definePermission('crm:activity:create', 'Registrar actividades', {
      description: 'Llamadas, correos, reuniones y notas sobre un cliente.',
    }),
    definePermission('crm:tag:read', 'Ver etiquetas'),
    definePermission('crm:tag:manage', 'Crear y editar etiquetas'),
  ],

  register(ctx) {
    const parties = new PgPartyRepository();
    const addresses = new PgAddressRepository();
    const contacts = new PgContactRepository();
    const profiles = new PgProfileRepository();
    const activities = new PgActivityRepository();
    const tags = new PgTagRepository();

    return {
      parties: new PartyUseCases(
        parties,
        addresses,
        contacts,
        profiles,
        tags,
        activities,
        ctx.audit,
        ctx.events,
        ctx.clock,
      ),
      crm: new CrmUseCases(parties, contacts, addresses, activities, tags, ctx.audit, ctx.clock),
    };
  },

  routes: crmRoutes,

  search(ctx, api) {
    return [
      {
        entityType: 'party',
        label: 'Clientes y proveedores',
        permission: 'crm:party:read',
        async search(tx, requestContext, term, limit) {
          const results = await api.parties.search(requestContext, tx, term, limit);
          return results.map((p) => ({
            entityType: 'party',
            id: p.id,
            title: p.display_name,
            ...(p.tax_id ? { subtitle: p.tax_id } : {}),
            url: `/clientes/${p.id}`,
          }));
        },
      },
    ];
  },
});

export type CrmApi = ReturnType<typeof crmModule.register>;
