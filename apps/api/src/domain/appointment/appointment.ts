import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';
import { Errors } from '../shared/errors.js';
import type { DomainError } from '../shared/domain-error.js';
import type { BookingPolicy } from './booking-policy.js';
import { canUserCancel } from './booking-policy.js';

export type AppointmentStatus =
  | 'CONFIRMED'
  | 'RESCHEDULED'
  | 'COMPLETED'
  | 'CANCELLED_BY_USER'
  | 'CANCELLED_BY_ADMIN'
  | 'NO_SHOW';

export type ActorRole = 'USER' | 'ADMIN' | 'SYSTEM';

export const TERMINAL_STATUSES: readonly AppointmentStatus[] = [
  'RESCHEDULED',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
  'NO_SHOW',
];

export function isTerminal(status: AppointmentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface Appointment {
  readonly id: string;
  readonly reference: string;
  readonly userId: string;
  readonly serviceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: AppointmentStatus;
  readonly meetingUrl: string;
  readonly serviceName: string;
  readonly amountPaise: number;
  readonly userNotes: string | null;
  readonly adminNotes: string | null;
  readonly cancellationReason: string | null;
  readonly cancelledAt: Date | null;
  readonly completedAt: Date | null;
  readonly supersededBy: string | null;
  readonly createdAt: Date;
}

/**
 * The state machine, expressed as data.
 *
 * Every transition the system permits is a row here. Anything not in this
 * table is rejected, which means adding a status without deciding its edges
 * breaks the tests rather than quietly creating a dead end.
 */
interface Transition {
  readonly from: AppointmentStatus;
  readonly to: AppointmentStatus;
  readonly actors: readonly ActorRole[];
}

export const APPOINTMENT_TRANSITIONS: readonly Transition[] = [
  { from: 'CONFIRMED', to: 'CANCELLED_BY_USER', actors: ['USER'] },
  { from: 'CONFIRMED', to: 'CANCELLED_BY_ADMIN', actors: ['ADMIN'] },
  { from: 'CONFIRMED', to: 'COMPLETED', actors: ['ADMIN'] },
  { from: 'CONFIRMED', to: 'NO_SHOW', actors: ['ADMIN'] },
  { from: 'CONFIRMED', to: 'RESCHEDULED', actors: ['USER', 'ADMIN'] },
];

export function isTransitionAllowed(
  from: AppointmentStatus,
  to: AppointmentStatus,
  actor: ActorRole,
): boolean {
  return APPOINTMENT_TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.actors.includes(actor),
  );
}

export interface TransitionInput {
  readonly appointment: Appointment;
  readonly to: AppointmentStatus;
  readonly actor: ActorRole;
  readonly now: Date;
  readonly policy: BookingPolicy;
  readonly reason?: string | null;
}

/**
 * Guards that depend on time or on supplied data, checked after the transition
 * table says the edge exists at all.
 */
export function checkTransition(input: TransitionInput): Result<void, DomainError> {
  const { appointment, to, actor, now, policy, reason } = input;

  if (isTerminal(appointment.status)) {
    return err(Errors.appointmentNotModifiable(appointment.status));
  }

  if (!isTransitionAllowed(appointment.status, to, actor)) {
    return err(Errors.illegalTransition(appointment.status, to));
  }

  switch (to) {
    case 'CANCELLED_BY_USER':
      // The 12-hour window. An admin cancelling has no such limit.
      if (!canUserCancel(appointment.startsAt, now, policy)) {
        return err(Errors.cancelWindowClosed(policy.cancelWindowHours));
      }
      return ok();

    case 'CANCELLED_BY_ADMIN':
      if (!reason || reason.trim().length === 0) {
        return err(Errors.validation('Give a reason — the client is told why'));
      }
      return ok();

    case 'COMPLETED':
      // Marking an appointment done before it has started is almost always a
      // misclick on the wrong row.
      if (now.getTime() < appointment.startsAt.getTime()) {
        return err(
          Errors.validation(
            'This appointment has not started yet',
            'You can mark it complete once the start time has passed.',
          ),
        );
      }
      return ok();

    case 'NO_SHOW':
      if (now.getTime() < appointment.endsAt.getTime()) {
        return err(
          Errors.validation(
            'This appointment is still in progress',
            'Wait until the end time before marking it a no-show.',
          ),
        );
      }
      return ok();

    case 'RESCHEDULED':
      // A user rescheduling is a cancel-and-rebook, so the same window applies.
      if (actor === 'USER' && !canUserCancel(appointment.startsAt, now, policy)) {
        return err(Errors.cancelWindowClosed(policy.cancelWindowHours));
      }
      return ok();

    default:
      return err(Errors.illegalTransition(appointment.status, to));
  }
}

/** A no-show increments the counter that eventually locks booking. */
export function incrementsNoShowCount(to: AppointmentStatus): boolean {
  return to === 'NO_SHOW';
}

/** The join link is only meaningful while the appointment is still ahead. */
export function visibleMeetingUrl(appointment: Appointment, now: Date): string | null {
  if (appointment.status !== 'CONFIRMED') return null;
  if (now.getTime() > appointment.endsAt.getTime()) return null;
  return appointment.meetingUrl;
}
