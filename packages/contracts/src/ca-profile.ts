import { z } from 'zod';

/**
 * What the landing page shows. Note the absence of `defaultMeetingUrl`: the
 * public serialiser must never include it, or anyone could walk into the CA's
 * meeting room without booking.
 */
export const publicCaProfileSchema = z.object({
  fullName: z.string(),
  headline: z.string().nullable(),
  membershipNumber: z.string().nullable(),
  firmName: z.string().nullable(),
  bio: z.string().nullable(),
  photoUrl: z.string().nullable(),
  yearsExperience: z.number().int().nullable(),
  qualifications: z.array(z.string()),
  specialisations: z.array(z.string()),
  languages: z.array(z.string()),
  officeAddress: z.string().nullable(),
  googleMapsUrl: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  whatsappNumber: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  timezone: z.string(),
});
export type PublicCaProfile = z.infer<typeof publicCaProfileSchema>;

/** The admin's view adds the two fields the public must not see. */
export const adminCaProfileSchema = publicCaProfileSchema.extend({
  defaultMeetingUrl: z.string().nullable(),
  isPublished: z.boolean(),
  updatedAt: z.string(),
});
export type AdminCaProfile = z.infer<typeof adminCaProfileSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : (v ?? null)));

export const upsertCaProfileRequestSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    headline: optionalText(160),
    membershipNumber: optionalText(40),
    firmName: optionalText(160),
    bio: optionalText(4000),
    photoUrl: optionalText(500),
    yearsExperience: z.number().int().min(0).max(70).optional().nullable(),
    qualifications: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    specialisations: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    languages: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    officeAddress: optionalText(400),
    googleMapsUrl: optionalText(500),
    contactEmail: z.email().optional().nullable().or(z.literal('').transform(() => null)),
    contactPhone: optionalText(24),
    whatsappNumber: optionalText(24),
    linkedinUrl: optionalText(300),
    defaultMeetingUrl: z.url().optional().nullable().or(z.literal('').transform(() => null)),
    timezone: z.string().default('Asia/Kolkata'),
    isPublished: z.boolean().default(false),
  })
  // The same rule the database enforces, checked here so the admin gets a
  // field-level message instead of a constraint violation.
  .refine((v) => !v.isPublished || !!v.defaultMeetingUrl, {
    message: 'Add a meeting room link before publishing — bookings confirm instantly and need one',
    path: ['defaultMeetingUrl'],
  });

export type UpsertCaProfileRequest = z.infer<typeof upsertCaProfileRequestSchema>;
