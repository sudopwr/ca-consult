import { z } from 'zod';
import { appointmentSchema } from './appointment.js';
import { itrEngagementSchema } from './itr-engagement.js';

/**
 * `GET /me/engagements` — one timeline covering both kinds.
 *
 * Appointments and ITR engagements are separate tables because they share
 * almost no invariants. What they do share is "my dealings with the CA", and
 * that is a read concern: the union lives here, in the response shape, rather
 * than being forced into storage.
 */
export const engagementItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('APPOINTMENT'),
    sortAt: z.string(),
    appointment: appointmentSchema,
  }),
  z.object({
    kind: z.literal('ITR'),
    sortAt: z.string(),
    engagement: itrEngagementSchema,
  }),
]);
export type EngagementItem = z.infer<typeof engagementItemSchema>;

export const myEngagementsResponseSchema = z.object({
  items: z.array(engagementItemSchema),
  /** Drives the empty state: no engagements at all means no message box either. */
  canMessage: z.boolean(),
});
export type MyEngagementsResponse = z.infer<typeof myEngagementsResponseSchema>;
