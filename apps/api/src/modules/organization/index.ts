/**
 * API PÚBLICA del módulo. Es lo único que otros módulos pueden importar:
 * `eslint-plugin-boundaries` bloquea cualquier import a su domain, application
 * o infrastructure. Así el módulo puede reescribirse por dentro sin romper nada.
 */
export { organizationModule, type OrganizationApi } from './module.js';
export type { Branch, Organization } from './domain/Organization.js';
export { isValidNit, nitCheckDigit } from './domain/Organization.js';
