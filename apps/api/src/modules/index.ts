import { catalogModule } from './catalog/module.js';
import { crmModule } from './crm/module.js';
import { identityModule } from './identity/module.js';
import { importsModule } from './imports/module.js';
import { organizationModule } from './organization/module.js';

/**
 * LA ÚNICA LISTA QUE CRECE.
 *
 * Añadir un módulo al sistema es añadir una línea aquí. El orden no importa:
 * el registro los ordena por sus dependencias antes de construirlos.
 */
export const modules = [organizationModule, identityModule, crmModule, catalogModule, importsModule] as const;

export type Modules = typeof modules;
