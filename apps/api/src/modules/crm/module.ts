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
import { crmRoutes, partyBody } from './infrastructure/http/crm.routes.js';

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

  /**
   * Importación de clientes y proveedores.
   *
   * `createOne` llama al MISMO caso de uso que el formulario: el dígito de
   * verificación del NIT se valida igual, el duplicado se detecta igual y la
   * auditoría registra igual. Una importación que se saltara eso metería en un
   * minuto los errores que el formulario lleva meses impidiendo.
   */
  imports(_ctx, api) {
    // Una fila de CSV solo trae campos planos: direcciones, perfiles y etiquetas
    // se gestionan aparte, y aceptarlos aquí prometería algo que el formato no
    // puede expresar.
    const IMPORTABLE_PARTY = partyBody.omit({
      address: true,
      customerProfile: true,
      vendorProfile: true,
      tagIds: true,
    });

    return [
      {
        entityType: 'party',
        label: 'Clientes y proveedores',
        permission: 'crm:party:create',
        fields: [
          {
            key: 'displayName',
            label: 'Nombre',
            required: true,
            aliases: ['nombre', 'cliente', 'razon social', 'empresa', 'proveedor', 'nombre comercial'],
          },
          { key: 'legalName', label: 'Razón social', aliases: ['razon social legal', 'nombre legal'] },
          {
            key: 'taxIdType',
            label: 'Tipo de documento',
            aliases: ['tipo documento', 'tipo id'],
            hint: 'NIT, CC, CE, TI, PP, NIT_EXT, PEP, NUIP o SIN_IDENTIFICAR',
          },
          {
            key: 'taxId',
            label: 'NIT',
            aliases: ['documento', 'identificacion', 'nit cc', 'cedula', 'numero documento'],
            hint: 'Sin puntos ni guiones; se normaliza solo',
          },
          { key: 'taxIdDv', label: 'DV', aliases: ['digito verificacion', 'dv'] },
          { key: 'email', label: 'Correo', aliases: ['email', 'correo electronico', 'e mail'] },
          { key: 'phone', label: 'Teléfono', aliases: ['telefono', 'tel', 'fijo'] },
          { key: 'mobile', label: 'Celular', aliases: ['movil', 'celular', 'whatsapp'] },
          { key: 'website', label: 'Sitio web', aliases: ['web', 'pagina web', 'sitio'] },
          { key: 'industry', label: 'Sector', aliases: ['sector', 'industria', 'actividad'] },
          { key: 'notes', label: 'Notas', aliases: ['notas', 'observaciones', 'comentarios'] },
          {
            key: 'isCustomer',
            label: 'Es cliente',
            type: 'boolean',
            aliases: ['cliente', 'es cliente'],
          },
          {
            key: 'isVendor',
            label: 'Es proveedor',
            type: 'boolean',
            aliases: ['proveedor', 'es proveedor'],
          },
        ],
        async createOne(tx, requestContext, row) {
          // El MISMO esquema que valida el formulario: sin esto, una importación
          // podría meter un correo que la API habría rechazado.
          const input = IMPORTABLE_PARTY.parse({
            ...row,
            ...(row.isCustomer === undefined ? {} : { isCustomer: row.isCustomer === 'true' }),
            ...(row.isVendor === undefined ? {} : { isVendor: row.isVendor === 'true' }),
          });
          const party = await api.parties.create(requestContext, tx, input);
          return { id: party.id, label: party.displayName };
        },
      },
    ];
  },

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
