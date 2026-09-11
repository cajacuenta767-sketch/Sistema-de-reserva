import { identityModule } from './identity/module.js';
import { organizationModule } from './organization/module.js';

/**
 * LA ÚNICA LISTA QUE CRECE.
 *
 * Añadir un módulo al sistema es añadir una línea aquí. El orden no importa:
 * el registro los ordena por sus dependencias antes de construirlos.
 */
export const modules = [organizationModule, identityModule] as const;

export type Modules = typeof modules;
