import { z } from 'zod';
import { instantSchema, localDateSchema } from './common.js';

const timeOfDaySchema = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use 24-hour HH:MM, e.g. 14:30');

export const availabilityRuleSchema = z.object({
  id: z.uuid(),
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday
  startTime: z.string(),
  endTime: z.string(),
  slotMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  isActive: z.boolean(),
});
export type AvailabilityRule = z.infer<typeof availabilityRuleSchema>;

export const upsertAvailabilityRuleRequestSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: timeOfDaySchema,
    endTime: timeOfDaySchema,
    slotMinutes: z.number().int().min(5).max(240),
    bufferMinutes: z.number().int().min(0).max(120).default(0),
    effectiveFrom: localDateSchema.optional(),
    effectiveTo: localDateSchema.optional().nullable(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: 'The window has to end after it starts',
    path: ['endTime'],
  })
  .refine((v) => !v.effectiveTo || !v.effectiveFrom || v.effectiveTo >= v.effectiveFrom, {
    message: 'The end date cannot be before the start date',
    path: ['effectiveTo'],
  });
export type UpsertAvailabilityRuleRequest = z.infer<typeof upsertAvailabilityRuleRequestSchema>;

export const exceptionKindSchema = z.enum(['BLOCKED', 'EXTRA']);
export type ExceptionKind = z.infer<typeof exceptionKindSchema>;

export const scheduleExceptionSchema = z.object({
  id: z.uuid(),
  kind: exceptionKindSchema,
  onDate: z.string(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  reason: z.string().nullable(),
});
export type ScheduleException = z.infer<typeof scheduleExceptionSchema>;

export const createScheduleExceptionRequestSchema = z
  .object({
    kind: exceptionKindSchema,
    onDate: localDateSchema,
    startTime: timeOfDaySchema.optional().nullable(),
    endTime: timeOfDaySchema.optional().nullable(),
    reason: z.string().trim().max(200).optional().nullable(),
  })
  .refine((v) => v.kind !== 'EXTRA' || (!!v.startTime && !!v.endTime), {
    message: 'An extra opening needs a start and end time',
    path: ['startTime'],
  })
  .refine((v) => (v.startTime == null) === (v.endTime == null), {
    message: 'Give both times or neither — neither means the whole day',
    path: ['endTime'],
  })
  .refine((v) => !v.startTime || !v.endTime || v.endTime > v.startTime, {
    message: 'The window has to end after it starts',
    path: ['endTime'],
  });
export type CreateScheduleExceptionRequest = z.infer<typeof createScheduleExceptionRequestSchema>;

/**
 * Blocking a date that already has confirmed appointments is allowed, but the
 * admin is told exactly which ones they have just orphaned so they can cancel
 * or reschedule them deliberately rather than discovering it later.
 */
export const scheduleConflictSchema = z.object({
  appointmentId: z.uuid(),
  reference: z.string(),
  startsAt: z.string(),
  userName: z.string().nullable(),
  userEmail: z.string(),
});
export type ScheduleConflict = z.infer<typeof scheduleConflictSchema>;

export const createScheduleExceptionResponseSchema = z.object({
  exception: scheduleExceptionSchema,
  conflicts: z.array(scheduleConflictSchema),
});

// ── slots ────────────────────────────────────────────────────────────────────

export const availabilityQuerySchema = z.object({
  serviceId: z.uuid(),
  from: localDateSchema,
  to: localDateSchema,
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const slotSchema = z.object({
  startsAt: instantSchema,
  endsAt: instantSchema,
});
export type Slot = z.infer<typeof slotSchema>;

export const daySlotsSchema = z.object({
  date: z.string(),
  slots: z.array(slotSchema),
});
export type DaySlots = z.infer<typeof daySlotsSchema>;

export const availabilityResponseSchema = z.object({
  serviceId: z.uuid(),
  timezone: z.string(),
  days: z.array(daySlotsSchema),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;
