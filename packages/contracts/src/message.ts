import { z } from 'zod';
import { pagedSchema } from './common.js';

export const threadStatusSchema = z.enum(['AWAITING_ADMIN', 'AWAITING_USER', 'CLOSED']);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const senderRoleSchema = z.enum(['USER', 'ADMIN']);
export type SenderRole = z.infer<typeof senderRoleSchema>;

export const messageSchema = z.object({
  id: z.uuid(),
  senderRole: senderRoleSchema,
  body: z.string(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

export const threadSummarySchema = z.object({
  id: z.uuid(),
  subject: z.string(),
  status: threadStatusSchema,
  appointmentId: z.uuid().nullable(),
  engagementId: z.uuid().nullable(),
  contextLabel: z.string().nullable(),
  lastMessageAt: z.string(),
  lastMessagePreview: z.string().nullable(),
  unread: z.number().int(),
  createdAt: z.string(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export const threadDetailSchema = threadSummarySchema.extend({
  messages: z.array(messageSchema),
});
export type ThreadDetail = z.infer<typeof threadDetailSchema>;

export const startThreadRequestSchema = z
  .object({
    subject: z.string().trim().min(3, 'Give your message a subject').max(200),
    body: z.string().trim().min(1, 'Write your message').max(5000),
    appointmentId: z.uuid().optional().nullable(),
    engagementId: z.uuid().optional().nullable(),
  })
  .refine((v) => !(v.appointmentId && v.engagementId), {
    message: 'Attach the thread to one engagement, not both',
    path: ['engagementId'],
  });
export type StartThreadRequest = z.infer<typeof startThreadRequestSchema>;

export const postMessageRequestSchema = z.object({
  body: z.string().trim().min(1, 'Write your message').max(5000),
});
export type PostMessageRequest = z.infer<typeof postMessageRequestSchema>;

export const adminThreadSummarySchema = threadSummarySchema.extend({
  userId: z.uuid(),
  userName: z.string().nullable(),
  userEmail: z.string(),
});
export type AdminThreadSummary = z.infer<typeof adminThreadSummarySchema>;

export const adminThreadDetailSchema = adminThreadSummarySchema.extend({
  messages: z.array(messageSchema),
});
export type AdminThreadDetail = z.infer<typeof adminThreadDetailSchema>;

export const adminThreadListQuerySchema = z.object({
  status: threadStatusSchema.optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminThreadListQuery = z.infer<typeof adminThreadListQuerySchema>;

export const adminThreadListResponseSchema = pagedSchema(adminThreadSummarySchema);

export const updateThreadRequestSchema = z.object({
  status: z.literal('CLOSED'),
});
export type UpdateThreadRequest = z.infer<typeof updateThreadRequestSchema>;
