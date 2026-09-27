import { z } from 'zod';
import { moneyPaiseSchema, pagedSchema, panSchema } from './common.js';

export const itrStatusSchema = z.enum([
  'SUBMITTED',
  'IN_REVIEW',
  'INFO_REQUESTED',
  'IN_PROGRESS',
  'FILED',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
]);
export type ItrStatus = z.infer<typeof itrStatusSchema>;

export const ITR_TERMINAL_STATUSES: readonly ItrStatus[] = [
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
];

/** Statuses a user may still cancel from — once work has started, they cannot. */
export const ITR_USER_CANCELLABLE: readonly ItrStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'INFO_REQUESTED',
];

export const itrEngagementSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  amountPaise: moneyPaiseSchema,
  status: itrStatusSchema,
  assessmentYear: z.string(),
  itrFormType: z.string(),
  hasBusinessIncome: z.boolean(),
  /** Masked as ABCDE****F for the owner; full value only in the admin view. */
  panNumber: z.string().nullable(),
  userNotes: z.string().nullable(),
  /** What the admin is waiting on, shown to the user when INFO_REQUESTED. */
  infoRequested: z.string().nullable(),
  acknowledgementNumber: z.string().nullable(),
  filedAt: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ItrEngagement = z.infer<typeof itrEngagementSchema>;

/**
 * No PAN field. A government identifier does not belong in a public
 * registration form — the admin asks for it through INFO_REQUESTED if and when
 * the filing needs it.
 */
export const registerItrEngagementRequestSchema = z.object({
  serviceId: z.uuid(),
  hasBusinessIncome: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type RegisterItrEngagementRequest = z.infer<typeof registerItrEngagementRequestSchema>;

export const cancelItrEngagementRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type CancelItrEngagementRequest = z.infer<typeof cancelItrEngagementRequestSchema>;

// ── admin ────────────────────────────────────────────────────────────────────

export const itrStatusHistorySchema = z.object({
  fromStatus: itrStatusSchema.nullable(),
  toStatus: itrStatusSchema,
  actorRole: z.enum(['USER', 'ADMIN', 'SYSTEM']),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type ItrStatusHistory = z.infer<typeof itrStatusHistorySchema>;

export const adminItrEngagementSchema = itrEngagementSchema.extend({
  userId: z.uuid(),
  userName: z.string().nullable(),
  userEmail: z.string(),
  userPhone: z.string().nullable(),
  adminNotes: z.string().nullable(),
  history: z.array(itrStatusHistorySchema).optional(),
});
export type AdminItrEngagement = z.infer<typeof adminItrEngagementSchema>;

export const adminItrListQuerySchema = z.object({
  status: itrStatusSchema.optional(),
  assessmentYear: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminItrListQuery = z.infer<typeof adminItrListQuerySchema>;

export const adminItrListResponseSchema = pagedSchema(adminItrEngagementSchema);

/**
 * The one route that can write a PAN. Everything else about the engagement
 * moves through the status machine.
 */
export const updateItrEngagementRequestSchema = z
  .object({
    status: itrStatusSchema.optional(),
    infoRequested: z.string().trim().max(2000).optional().nullable(),
    acknowledgementNumber: z.string().trim().max(40).optional().nullable(),
    panNumber: panSchema.optional().nullable(),
    adminNotes: z.string().trim().max(4000).optional().nullable(),
    cancellationReason: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.status !== 'INFO_REQUESTED' || !!v.infoRequested, {
    message: 'Say what you need from the client — they see this text',
    path: ['infoRequested'],
  })
  .refine((v) => v.status !== 'FILED' || !!v.acknowledgementNumber, {
    message: 'Record the acknowledgement number when marking a return filed',
    path: ['acknowledgementNumber'],
  })
  .refine((v) => v.status !== 'CANCELLED_BY_ADMIN' || !!v.cancellationReason, {
    message: 'Give a reason — the client is told why',
    path: ['cancellationReason'],
  });
export type UpdateItrEngagementRequest = z.infer<typeof updateItrEngagementRequestSchema>;

/** The masking applied to every non-admin serialisation of a PAN. */
export function maskPan(pan: string | null): string | null {
  if (!pan || pan.length !== 10) return pan;
  return `${pan.slice(0, 5)}****${pan.slice(9)}`;
}
