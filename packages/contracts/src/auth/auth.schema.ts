import { z } from 'zod';
import { PERMISSION_SCOPES } from '../common/permissions.js';

export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128)
  .refine((v) => /[a-z]/.test(v), 'Debe incluir una minúscula')
  .refine((v) => /[A-Z]/.test(v), 'Debe incluir una mayúscula')
  .refine((v) => /\d/.test(v), 'Debe incluir un número');

export const emailSchema = z.email('Correo inválido').max(254).toLowerCase().trim();

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).optional(),
  /** Crea una organización nueva junto con la cuenta. */
  organizationName: z.string().trim().min(2).max(160).optional(),
  /** O se une a una existente mediante invitación. */
  invitationToken: z.string().min(10).max(200).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'La contraseña es obligatoria').max(128),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  locale: z.enum(['es-CO', 'en-US']).optional(),
  avatarFileId: z.uuid().nullable().optional(),
});

export const switchOrganizationSchema = z.object({ organizationId: z.uuid() });

// ── Respuestas ────────────────────────────────────────────────────────────────

export const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  refreshTokenId: z.string().optional(),
});
export type Tokens = z.infer<typeof tokensSchema>;

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.string(),
  isSuperAdmin: z.boolean(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  tradeName: z.string(),
  legalName: z.string(),
  taxId: z.string().nullable(),
  functionalCurrency: z.string(),
  brandHue: z.number().int().nullable(),
  logoUrl: z.string().nullable(),
  membershipId: z.uuid(),
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const sessionSchema = z.object({
  user: publicUserSchema,
  organizations: z.array(organizationSummarySchema),
  activeOrganizationId: z.uuid().nullable(),
  permissions: z.record(z.string(), z.enum(PERMISSION_SCOPES)),
  roles: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type Session = z.infer<typeof sessionSchema>;

export const authResultSchema = z.object({ tokens: tokensSchema, session: sessionSchema });
export type AuthResult = z.infer<typeof authResultSchema>;
