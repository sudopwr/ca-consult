import { z } from 'zod';
import { adminAppointmentSchema } from './appointment.js';
import { itrStatusSchema } from './itr-engagement.js';

/**
 * `GET /admin/dashboard` — what the practitioner sees on opening the panel.
 * Everything here is something they might act on today; nothing is a vanity
 * metric.
 */
export const adminDashboardSchema = z.object({
  today: z.object({
    date: z.string(),
    appointments: z.array(adminAppointmentSchema),
    remainingCount: z.number().int(),
  }),
  upcomingSevenDays: z.number().int(),
  itrPipeline: z.array(
    z.object({
      status: itrStatusSchema,
      count: z.number().int(),
    }),
  ),
  /** Engagements sitting in INFO_REQUESTED — the queue the client is blocking on. */
  awaitingClientInfo: z.number().int(),
  newUsersThisWeek: z.number().int(),
  unreadThreads: z.number().int(),
  newEnquiries: z.number().int(),
  outbox: z.object({
    pending: z.number().int(),
    failed: z.number().int(),
    dead: z.number().int(),
  }),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
