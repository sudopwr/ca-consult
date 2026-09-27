import { describe, expect, it } from 'vitest';
import {
  APPOINTMENT_TRANSITIONS,
  TERMINAL_STATUSES,
  checkTransition,
  isTerminal,
  isTransitionAllowed,
  visibleMeetingUrl,
} from '../../src/domain/appointment/appointment.js';
import type { Appointment, AppointmentStatus, ActorRole } from '../../src/domain/appointment/appointment.js';
import { DEFAULT_BOOKING_POLICY } from '../../src/domain/appointment/booking-policy.js';

const P = DEFAULT_BOOKING_POLICY;
const STARTS = new Date('2026-09-20T11:00:00+05:30');
const ENDS = new Date('2026-09-20T11:30:00+05:30');

function appointment(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1',
    reference: 'APT-2026-000001',
    userId: 'u1',
    serviceId: 's1',
    startsAt: STARTS,
    endsAt: ENDS,
    status: 'CONFIRMED',
    meetingUrl: 'https://meet.example/room',
    serviceName: 'Tax Planning Consultation',
    amountPaise: 149900,
    userNotes: null,
    adminNotes: null,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    supersededBy: null,
    createdAt: new Date('2026-09-16T09:00:00+05:30'),
    ...over,
  };
}

const ALL_STATUSES: AppointmentStatus[] = [
  'CONFIRMED',
  'RESCHEDULED',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
  'NO_SHOW',
];
const ALL_ACTORS: ActorRole[] = ['USER', 'ADMIN', 'SYSTEM'];

describe('the transition table', () => {
  it('starts every transition from CONFIRMED — bookings auto-confirm', () => {
    expect(APPOINTMENT_TRANSITIONS.every((t) => t.from === 'CONFIRMED')).toBe(true);
  });

  it('agrees with isTerminal about which statuses are dead ends', () => {
    for (const status of ALL_STATUSES) {
      const hasOutgoing = APPOINTMENT_TRANSITIONS.some((t) => t.from === status);
      expect(isTerminal(status)).toBe(!hasOutgoing);
    }
  });

  it('rejects every pair that is not in the table', () => {
    // Exhaustive, so adding a status without deciding its edges breaks here
    // rather than creating a silent dead end in production.
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        for (const actor of ALL_ACTORS) {
          const inTable = APPOINTMENT_TRANSITIONS.some(
            (t) => t.from === from && t.to === to && t.actors.includes(actor),
          );
          expect(isTransitionAllowed(from, to, actor)).toBe(inTable);
        }
      }
    }
  });

  it('never lets a user complete or no-show an appointment', () => {
    expect(isTransitionAllowed('CONFIRMED', 'COMPLETED', 'USER')).toBe(false);
    expect(isTransitionAllowed('CONFIRMED', 'NO_SHOW', 'USER')).toBe(false);
  });

  it('never lets an admin cancel as if they were the user', () => {
    expect(isTransitionAllowed('CONFIRMED', 'CANCELLED_BY_USER', 'ADMIN')).toBe(false);
  });
});

describe('checkTransition — terminal states', () => {
  it.each(TERMINAL_STATUSES.map((s) => [s]))('refuses any change from %s', (status) => {
    const result = checkTransition({
      appointment: appointment({ status: status as AppointmentStatus }),
      to: 'COMPLETED',
      actor: 'ADMIN',
      now: new Date('2026-09-20T12:00:00+05:30'),
      policy: P,
    });

    expect(result).toBeErr('ENGAGEMENT_NOT_MODIFIABLE');
  });
});

describe('checkTransition — user cancellation', () => {
  it('allows a cancellation well before the window closes', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'CANCELLED_BY_USER',
        actor: 'USER',
        now: new Date('2026-09-19T09:00:00+05:30'),
        policy: P,
      }),
    ).toBeOk();
  });

  it('allows a cancellation at exactly 12 hours', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'CANCELLED_BY_USER',
        actor: 'USER',
        now: new Date('2026-09-19T23:00:00+05:30'),
        policy: P,
      }),
    ).toBeOk();
  });

  it('refuses a cancellation 11 hours 59 minutes before', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'CANCELLED_BY_USER',
        actor: 'USER',
        now: new Date('2026-09-19T23:01:00+05:30'),
        policy: P,
      }),
    ).toBeErr('CANCEL_WINDOW_CLOSED');
  });
});

describe('checkTransition — admin actions', () => {
  it('refuses an admin cancellation with no reason', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'CANCELLED_BY_ADMIN',
        actor: 'ADMIN',
        now: new Date('2026-09-19T09:00:00+05:30'),
        policy: P,
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('refuses an admin cancellation whose reason is only whitespace', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'CANCELLED_BY_ADMIN',
        actor: 'ADMIN',
        now: new Date('2026-09-19T09:00:00+05:30'),
        policy: P,
        reason: '   ',
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('accepts an admin cancellation with a reason, at any notice', () => {
    // No 12-hour limit for the CA — they may have to cancel on the morning.
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'CANCELLED_BY_ADMIN',
        actor: 'ADMIN',
        now: new Date('2026-09-20T10:55:00+05:30'),
        policy: P,
        reason: 'Called into a hearing',
      }),
    ).toBeOk();
  });

  it('refuses COMPLETED before the appointment has started', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'COMPLETED',
        actor: 'ADMIN',
        now: new Date('2026-09-20T10:00:00+05:30'),
        policy: P,
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('allows COMPLETED once the start time has passed', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'COMPLETED',
        actor: 'ADMIN',
        now: new Date('2026-09-20T11:20:00+05:30'),
        policy: P,
      }),
    ).toBeOk();
  });

  it('refuses NO_SHOW while the appointment is still running', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'NO_SHOW',
        actor: 'ADMIN',
        now: new Date('2026-09-20T11:20:00+05:30'),
        policy: P,
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('allows NO_SHOW once the end time has passed', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'NO_SHOW',
        actor: 'ADMIN',
        now: new Date('2026-09-20T11:30:00+05:30'),
        policy: P,
      }),
    ).toBeOk();
  });
});

describe('checkTransition — reschedule', () => {
  it('holds the user to the same 12-hour window', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'RESCHEDULED',
        actor: 'USER',
        now: new Date('2026-09-20T06:00:00+05:30'),
        policy: P,
      }),
    ).toBeErr('CANCEL_WINDOW_CLOSED');
  });

  it('places no such limit on the admin', () => {
    expect(
      checkTransition({
        appointment: appointment(),
        to: 'RESCHEDULED',
        actor: 'ADMIN',
        now: new Date('2026-09-20T06:00:00+05:30'),
        policy: P,
      }),
    ).toBeOk();
  });
});

describe('visibleMeetingUrl', () => {
  it('shows the link for a confirmed appointment still ahead', () => {
    expect(visibleMeetingUrl(appointment(), new Date('2026-09-20T10:00:00+05:30')))
      .toBe('https://meet.example/room');
  });

  it('shows it during the appointment', () => {
    expect(visibleMeetingUrl(appointment(), new Date('2026-09-20T11:15:00+05:30')))
      .toBe('https://meet.example/room');
  });

  it('hides it once the appointment is over', () => {
    expect(visibleMeetingUrl(appointment(), new Date('2026-09-20T12:00:00+05:30'))).toBeNull();
  });

  it('hides it for a cancelled appointment', () => {
    expect(
      visibleMeetingUrl(
        appointment({ status: 'CANCELLED_BY_USER' }),
        new Date('2026-09-20T10:00:00+05:30'),
      ),
    ).toBeNull();
  });
});
