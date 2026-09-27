import { z } from 'zod';

/**
 * Every error the API returns has this shape (RFC 9457 problem+json, plus a
 * machine-readable `code` and the request's `traceId`).
 *
 * `code` is what clients branch on. `title`/`detail` are what humans read.
 */
export const ErrorCode = {
  // transport / generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL',
  RATE_LIMITED: 'RATE_LIMITED',

  // auth (slice 2)
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  ACCOUNT_BLOCKED: 'ACCOUNT_BLOCKED',
  PROFILE_INCOMPLETE: 'PROFILE_INCOMPLETE',
  NO_ENGAGEMENT: 'NO_ENGAGEMENT',

  // booking (slice 6)
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  CANCEL_WINDOW_CLOSED: 'CANCEL_WINDOW_CLOSED',
  BOOKING_LIMIT_REACHED: 'BOOKING_LIMIT_REACHED',

  // ITR (slice 7)
  DUPLICATE_ENGAGEMENT: 'DUPLICATE_ENGAGEMENT',
  ENGAGEMENT_NOT_MODIFIABLE: 'ENGAGEMENT_NOT_MODIFIABLE',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  traceId: z.string().optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
