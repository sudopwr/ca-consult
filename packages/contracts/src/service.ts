import { z } from 'zod';
import { assessmentYearSchema, itrFormTypeSchema, moneyPaiseSchema } from './common.js';

export const serviceKindSchema = z.enum(['CONSULTANCY', 'ITR_FILING']);
export type ServiceKind = z.infer<typeof serviceKindSchema>;

export const serviceSchema = z.object({
  id: z.uuid(),
  kind: serviceKindSchema,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  amountPaise: moneyPaiseSchema,
  currency: z.string(),
  durationMinutes: z.number().int().nullable(),
  assessmentYear: z.string().nullable(),
  itrFormType: z.string().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
});
export type Service = z.infer<typeof serviceSchema>;

export const publicServiceListQuerySchema = z.object({
  kind: serviceKindSchema.optional(),
});
export type PublicServiceListQuery = z.infer<typeof publicServiceListQuerySchema>;

/**
 * The two kinds carry different required fields, so the schema is a refined
 * union rather than a bag of optionals — the form gets a message on the right
 * field instead of a generic failure.
 */
export const upsertServiceRequestSchema = z
  .object({
    kind: serviceKindSchema,
    name: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase words separated by hyphens'),
    description: z.string().trim().max(2000).optional().nullable(),
    amountPaise: moneyPaiseSchema,
    durationMinutes: z.number().int().min(5).max(480).optional().nullable(),
    assessmentYear: assessmentYearSchema.optional().nullable(),
    itrFormType: itrFormTypeSchema.optional().nullable(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })
  .refine((v) => v.kind !== 'CONSULTANCY' || v.durationMinutes != null, {
    message: 'A consultation needs a duration — it is what sizes the booking slot',
    path: ['durationMinutes'],
  })
  .refine((v) => v.kind !== 'ITR_FILING' || !!v.assessmentYear, {
    message: 'An ITR service needs an assessment year',
    path: ['assessmentYear'],
  })
  .refine((v) => v.kind !== 'ITR_FILING' || !!v.itrFormType, {
    message: 'An ITR service needs a form type',
    path: ['itrFormType'],
  });

export type UpsertServiceRequest = z.infer<typeof upsertServiceRequestSchema>;
