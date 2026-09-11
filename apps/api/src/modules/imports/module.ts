import { definePermission } from '@erp/contracts';
import { defineModule } from '../../platform/modules/types.js';
import { ImportUseCases } from './application/use-cases/ImportUseCases.js';
import { PgImportRepository } from './infrastructure/persistence/PgImportRepository.js';
import { importsRoutes } from './infrastructure/http/imports.routes.js';

export const importsModule = defineModule({
  id: 'imports',
  // Los importadores los registran otros módulos; éste se construye después
  // para que su registro esté completo cuando alguien lo consulte.
  dependsOn: ['crm', 'catalog'],

  permissions: [
    definePermission('platform:import:read', 'Ver importaciones'),
    definePermission('platform:import:create', 'Importar desde fichero', {
      description:
        'Además de este permiso hace falta el de crear la entidad que se importa: ' +
        'importar no es un atajo para saltarse quién puede crear qué.',
    }),
  ],

  register(ctx) {
    return {
      imports: new ImportUseCases(new PgImportRepository(), ctx.imports, ctx.audit, ctx.clock),
    };
  },

  routes: importsRoutes,
});

export type ImportsApi = ReturnType<typeof importsModule.register>;
