import { z } from 'zod';

/** Sobre de error uniforme de toda la API. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const pagedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    aggregates: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  });

export const collectionSchema = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

/** Identificador de recurso en rutas. */
export const idParam = z.object({ id: z.uuid() });

/** Importe monetario tal como viaja por la API: string exacto + moneda. */
export const moneySchema = z.object({
  amount: z.string().regex(/^-?\d+(\.\d+)?$/, 'Importe inválido'),
  currency: z.string().length(3),
});
export type MoneyDto = z.infer<typeof moneySchema>;

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato YYYY-MM-DD');

export const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'La fecha y hora deben tener el formato YYYY-MM-DDTHH:MM');
