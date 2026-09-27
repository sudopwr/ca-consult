import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOOKING_POLICY,
  canUserCancel,
  cancelDeadline,
  refuseBooking,
} from '../../src/domain/appointment/booking-policy.js';

const NOW = new Date('2026-09-16T09:00:00+05:30');
const P = DEFAULT_BOOKING_POLICY;

function attempt(over: Partial<Parameters<typeof refuseBooking>[0]> = {}) {
  return {
    startsAt: new Date('2026-09-18T11:00:00+05:30'),
    now: NOW,
    upcomingCount: 0,
    bookedTodayCount: 0,
    noShowCount: 0,
    ...over,
  };
}

describe('refuseBooking', () => {
  it('allows a normal booking', () => {
    expect(refuseBooking(attempt(), P)).toBeNull();
  });

  it('refuses a slot in the past', () => {
    expect(refuseBooking(attempt({ startsAt: new Date('2026-09-15T11:00:00+05:30') }), P))
      .toMatchObject({ reason: 'IN_THE_PAST' });
  });

  it('refuses a slot at exactly now', () => {
    expect(refuseBooking(attempt({ startsAt: NOW }), P)).toMatchObject({ reason: 'IN_THE_PAST' });
  });

  it('refuses a slot inside the lead time', () => {
    // 119 minutes out, against a 120-minute minimum.
    expect(refuseBooking(attempt({ startsAt: new Date(NOW.getTime() + 119 * 60_000) }), P))
      .toMatchObject({ reason: 'TOO_SOON', minLeadMinutes: 120 });
  });

  it('allows a slot exactly on the lead-time boundary', () => {
    expect(refuseBooking(attempt({ startsAt: new Date(NOW.getTime() + 120 * 60_000) }), P))
      .toBeNull();
  });

  it('refuses a slot beyond the advance window', () => {
    expect(refuseBooking(attempt({ startsAt: new Date(NOW.getTime() + 61 * 86_400_000) }), P))
      .toMatchObject({ reason: 'TOO_FAR', maxAdvanceDays: 60 });
  });

  it('allows a slot exactly on the advance boundary', () => {
    expect(refuseBooking(attempt({ startsAt: new Date(NOW.getTime() + 60 * 86_400_000) }), P))
      .toBeNull();
  });

  it('refuses a fourth upcoming appointment', () => {
    expect(refuseBooking(attempt({ upcomingCount: 3 }), P))
      .toMatchObject({ reason: 'TOO_MANY_UPCOMING', limit: 3 });
    expect(refuseBooking(attempt({ upcomingCount: 2 }), P)).toBeNull();
  });

  it('refuses a third booking made in one day', () => {
    expect(refuseBooking(attempt({ bookedTodayCount: 2 }), P))
      .toMatchObject({ reason: 'TOO_MANY_TODAY', limit: 2 });
  });

  it('refuses a user who has been locked out for no-shows', () => {
    expect(refuseBooking(attempt({ noShowCount: 3 }), P))
      .toMatchObject({ reason: 'NO_SHOW_LOCKOUT', count: 3, limit: 3 });
    expect(refuseBooking(attempt({ noShowCount: 2 }), P)).toBeNull();
  });

  it('reports the lockout ahead of everything else', () => {
    // The most actionable message wins: telling a locked-out user about lead
    // time would send them round a loop they cannot exit.
    const refusal = refuseBooking(
      attempt({ noShowCount: 5, startsAt: new Date('2020-01-01T00:00:00Z'), upcomingCount: 9 }),
      P,
    );
    expect(refusal).toMatchObject({ reason: 'NO_SHOW_LOCKOUT' });
  });
});

describe('canUserCancel', () => {
  const startsAt = new Date('2026-09-20T11:00:00+05:30');

  it('allows cancelling a day ahead', () => {
    expect(canUserCancel(startsAt, new Date('2026-09-19T11:00:00+05:30'), P)).toBe(true);
  });

  it('allows cancelling at exactly the 12-hour mark', () => {
    expect(canUserCancel(startsAt, new Date('2026-09-19T23:00:00+05:30'), P)).toBe(true);
  });

  it('refuses one minute inside the window', () => {
    expect(canUserCancel(startsAt, new Date('2026-09-19T23:01:00+05:30'), P)).toBe(false);
  });

  it('refuses after the appointment has started', () => {
    expect(canUserCancel(startsAt, new Date('2026-09-20T11:30:00+05:30'), P)).toBe(false);
  });

  it('reports the deadline so the UI can show it', () => {
    expect(cancelDeadline(startsAt, P).toISOString()).toBe('2026-09-19T17:30:00.000Z');
  });
});
