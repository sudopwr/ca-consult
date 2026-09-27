import { HOUR_MS, MINUTE_MS } from '../shared/time.js';

/**
 * The rules that stop the calendar being abused.
 *
 * These matter more than they would with an approval step. Bookings
 * auto-confirm, so nobody is reviewing them before they occupy a slot — these
 * limits are the whole of the brake.
 */
export interface BookingPolicy {
  readonly minLeadMinutes: number;
  readonly maxAdvanceDays: number;
  readonly cancelWindowHours: number;
  readonly maxUpcomingPerUser: number;
  readonly maxPerUserPerDay: number;
  readonly noShowLockout: number;
}

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  minLeadMinutes: 120,
  maxAdvanceDays: 60,
  cancelWindowHours: 12,
  maxUpcomingPerUser: 3,
  maxPerUserPerDay: 2,
  noShowLockout: 3,
};

export type BookingRefusal =
  | { reason: 'TOO_SOON'; minLeadMinutes: number }
  | { reason: 'TOO_FAR'; maxAdvanceDays: number }
  | { reason: 'IN_THE_PAST' }
  | { reason: 'TOO_MANY_UPCOMING'; limit: number }
  | { reason: 'TOO_MANY_TODAY'; limit: number }
  | { reason: 'NO_SHOW_LOCKOUT'; count: number; limit: number };

export interface BookingAttempt {
  readonly startsAt: Date;
  readonly now: Date;
  readonly upcomingCount: number;
  readonly bookedTodayCount: number;
  readonly noShowCount: number;
}

/**
 * Returns the first reason the booking may not proceed, or null if it may.
 *
 * Ordering is deliberate: the checks a user can do something about come last,
 * so the message they see is the most actionable one. A locked-out user is
 * told about the lockout rather than about the lead time.
 */
export function refuseBooking(
  attempt: BookingAttempt,
  policy: BookingPolicy,
): BookingRefusal | null {
  const { startsAt, now, upcomingCount, bookedTodayCount, noShowCount } = attempt;

  if (noShowCount >= policy.noShowLockout) {
    return { reason: 'NO_SHOW_LOCKOUT', count: noShowCount, limit: policy.noShowLockout };
  }

  if (startsAt.getTime() <= now.getTime()) {
    return { reason: 'IN_THE_PAST' };
  }

  const leadMs = startsAt.getTime() - now.getTime();
  if (leadMs < policy.minLeadMinutes * MINUTE_MS) {
    return { reason: 'TOO_SOON', minLeadMinutes: policy.minLeadMinutes };
  }

  if (leadMs > policy.maxAdvanceDays * 24 * HOUR_MS) {
    return { reason: 'TOO_FAR', maxAdvanceDays: policy.maxAdvanceDays };
  }

  if (upcomingCount >= policy.maxUpcomingPerUser) {
    return { reason: 'TOO_MANY_UPCOMING', limit: policy.maxUpcomingPerUser };
  }

  if (bookedTodayCount >= policy.maxPerUserPerDay) {
    return { reason: 'TOO_MANY_TODAY', limit: policy.maxPerUserPerDay };
  }

  return null;
}

/** Whether the owner may still cancel without asking the CA. */
export function canUserCancel(startsAt: Date, now: Date, policy: BookingPolicy): boolean {
  return startsAt.getTime() - now.getTime() >= policy.cancelWindowHours * HOUR_MS;
}

/** The instant after which self-service cancellation closes. */
export function cancelDeadline(startsAt: Date, policy: BookingPolicy): Date {
  return new Date(startsAt.getTime() - policy.cancelWindowHours * HOUR_MS);
}

export function describeRefusal(refusal: BookingRefusal): string {
  switch (refusal.reason) {
    case 'IN_THE_PAST':
      return 'That time has already passed.';
    case 'TOO_SOON':
      return `Appointments need at least ${refusal.minLeadMinutes} minutes' notice.`;
    case 'TOO_FAR':
      return `The calendar only opens ${refusal.maxAdvanceDays} days ahead.`;
    case 'TOO_MANY_UPCOMING':
      return `You already have ${refusal.limit} appointments booked. Attend or cancel one before booking another.`;
    case 'TOO_MANY_TODAY':
      return `You can book up to ${refusal.limit} appointments per day. Try again tomorrow.`;
    case 'NO_SHOW_LOCKOUT':
      return `Online booking is paused after ${refusal.limit} missed appointments. Send a message and the CA can reopen it.`;
  }
}
