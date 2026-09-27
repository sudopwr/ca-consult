import { z } from 'zod';
import { pagedSchema } from './common.js';

export const enquiryStatusSchema = z.enum(['NEW', 'READ', 'REPLIED', 'SPAM']);
export type EnquiryStatus = z.infer<typeof enquiryStatusSchema>;

/**
 * The visitor contact form. Visitors cannot open a message thread — that needs
 * an engagement — so this is the way in for someone who has not booked yet.
 *
 * Four defences, cheapest first: the honeypot (a hidden field a human never
 * fills), the Turnstile token, an IP rate limit at the route, and a minimum
 * dwell time. `renderedAt` is what makes the last one possible.
 */
export const submitContactEnquiryRequestSchema = z.object({
  name: z.string().trim().min(2, 'Tell us your name').max(120),
  email: z.email('Enter an email we can reply to'),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid phone number')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  subject: z.string().trim().min(3, 'Give your enquiry a subject').max(200),
  body: z.string().trim().min(10, 'Tell us a little more — at least 10 characters').max(3000),

  /** Cloudflare Turnstile response token, verified server-side. */
  captchaToken: z.string().min(1, 'Please complete the verification'),

  /** Hidden field. Anything here means a bot filled the form. */
  website: z.string().max(0).optional().default(''),

  /** Epoch ms when the form rendered; submissions under 3s are rejected. */
  renderedAt: z.number().int().optional(),
});
export type SubmitContactEnquiryRequest = z.infer<typeof submitContactEnquiryRequestSchema>;

/**
 * Always 202 with the same body, whether the enquiry was stored, silently
 * dropped as spam, or failed the captcha. A bot that cannot tell the
 * difference cannot tune itself.
 */
export const submitContactEnquiryResponseSchema = z.object({
  accepted: z.literal(true),
});

export const contactEnquirySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  status: enquiryStatusSchema,
  adminNote: z.string().nullable(),
  repliedAt: z.string().nullable(),
  sourceIp: z.string().nullable(),
  createdAt: z.string(),
});
export type ContactEnquiry = z.infer<typeof contactEnquirySchema>;

export const adminEnquiryListQuerySchema = z.object({
  status: enquiryStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminEnquiryListQuery = z.infer<typeof adminEnquiryListQuerySchema>;

export const adminEnquiryListResponseSchema = pagedSchema(contactEnquirySchema);

export const updateEnquiryRequestSchema = z.object({
  status: enquiryStatusSchema.optional(),
  adminNote: z.string().trim().max(2000).optional().nullable(),
});
export type UpdateEnquiryRequest = z.infer<typeof updateEnquiryRequestSchema>;
