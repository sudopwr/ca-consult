import { z } from 'zod';
import { instantSchema, moneyPaiseSchema, pagedSchema } from './common.js';

export const appointmentStatusSchema = z.enum([
  'CONFIRMED',
  'RESCHEDULED',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
  'NO_SHOW',
]);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const APPOINTMENT_TERMINAL_STATUSES: readonly AppointmentStatus[] = [
  'RESCHEDULED',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
  'NO_SHOW',
];

/** What the owner of the appointment sees. `adminNotes` is not in this shape. */
export const appointmentSchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  amountPaise: moneyPaiseSchema,
  startsAt: z.string(),
  endsAt: z.string(),
  status: appointmentStatusSchema,
  /** Present only while the appointment is confirmed and still ahead. */
  meetingUrl: z.string().nullable(),
  userNotes: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  supersededBy: z.uuid().nullable(),
  createdAt: z.string(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const bookAppointmentRequestSchema = z.object({
  serviceId: z.uuid(),
  startsAt: instantSchema,
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type BookAppointmentRequest = z.infer<typeof bookAppointmentRequestSchema>;

export const cancelAppointmentRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Tell us briefly why').max(500),
});
export type CancelAppointmentRequest = z.infer<typeof cancelAppointmentRequestSchema>;

export const rescheduleAppointmentRequestSchema = z.object({
  startsAt: instantSchema,
  notifyUser: z.boolean().default(true),
});
export type RescheduleAppointmentRequest = z.infer<typeof rescheduleAppointmentRequestSchema>;

// ── admin ────────────────────────────────────────────────────────────────────

export const appointmentStatusHistorySchema = z.object({
  fromStatus: appointmentStatusSchema.nullable(),
  toStatus: appointmentStatusSchema,
  actorRole: z.enum(['USER', 'ADMIN', 'SYSTEM']),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type AppointmentStatusHistory = z.infer<typeof appointmentStatusHistorySchema>;

export const adminAppointmentSchema = appointmentSchema.extend({
  userId: z.uuid(),
  userName: z.string().nullable(),
  userEmail: z.string(),
  userPhone: z.string().nullable(),
  adminNotes: z.string().nullable(),
  history: z.array(appointmentStatusHistorySchema).optional(),
});
export type AdminAppointment = z.infer<typeof adminAppointmentSchema>;

export const adminAppointmentListQuerySchema = z.object({
  status: appointmentStatusSchema.optional(),
  scope: z.enum(['today', 'upcoming', 'past', 'all']).default('upcoming'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  serviceId: z.uuid().optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminAppointmentListQuery = z.infer<typeof adminAppointmentListQuerySchema>;

export const adminAppointmentListResponseSchema = pagedSchema(adminAppointmentSchema);

export const updateAppointmentRequestSchema = z
  .object({
    status: z.enum(['COMPLETED', 'NO_SHOW', 'CANCELLED_BY_ADMIN']).optional(),
    adminNotes: z.string().trim().max(4000).optional().nullable(),
    meetingUrl: z.url().optional().nullable(),
    cancellationReason: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.status !== 'CANCELLED_BY_ADMIN' || !!v.cancellationReason, {
    message: 'Give a reason — the client is told why',
    path: ['cancellationReason'],
  });
export type UpdateAppointmentRequest = z.infer<typeof updateAppointmentRequestSchema>;

export const myEngagementsQuerySchema = z.object({
  scope: z.enum(['upcoming', 'past', 'all']).default('all'),
});
export type MyEngagementsQuery = z.infer<typeof myEngagementsQuerySchema>;
