/** API pública del módulo de identidad. */
export { identityModule, type IdentityApi } from './module.js';
export type { Membership, PublicUser, Role, Team, User } from './domain/User.js';
export { fullName, toPublicUser } from './domain/User.js';
export { SYSTEM_ROLE_TEMPLATES, resolveTemplate } from './domain/roleTemplates.js';
