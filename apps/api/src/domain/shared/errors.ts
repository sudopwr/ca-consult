import { DomainError } from './domain-error.js';

/**
 * Every expected failure in the system, in one place.
 *
 * The `code` strings match `ErrorCode` in @ca/contracts, and the interface
 * layer maps them to HTTP statuses. The domain itself never knows a status
 * code — which is what keeps `domain/` importable from a CLI, a worker or a
 * test without dragging HTTP along.
 */

export const Errors = {
  notFound: (what: string, detail?: string) =>
    new DomainError('NOT_FOUND', `${what} not found`, detail),

  forbidden: (detail?: string) =>
    new DomainError('FORBIDDEN', 'You do not have access to this', detail),

  unauthenticated: (detail?: string) =>
    new DomainError('UNAUTHENTICATED', 'Sign in to continue', detail),

  accountBlocked: () =>
    new DomainError(
      'ACCOUNT_BLOCKED',
      'This account has been suspended',
      'Contact the practice if you think this is a mistake.',
    ),

  profileIncomplete: () =>
    new DomainError(
      'PROFILE_INCOMPLETE',
      'Finish setting up your profile first',
      'We need your name, phone number and address before you can book.',
    ),

  noEngagement: () =>
    new DomainError(
      'NO_ENGAGEMENT',
      'Messaging is for clients with a booking',
      'Book a consultation or register an ITR filing to message the CA directly. For anything else, use the contact form.',
    ),

  validation: (message: string, detail?: string) =>
    new DomainError('VALIDATION_FAILED', message, detail),

  // ── booking ────────────────────────────────────────────────────────────────

  slotUnavailable: (detail?: string) =>
    new DomainError('SLOT_UNAVAILABLE', 'That slot is no longer available', detail),

  cancelWindowClosed: (hours: number) =>
    new DomainError(
      'CANCEL_WINDOW_CLOSED',
      'It is too late to cancel online',
      `Appointments can be cancelled up to ${hours} hours before the start time. Send a message and the CA will sort it out.`,
    ),

  bookingLimitReached: (detail: string) =>
    new DomainError('BOOKING_LIMIT_REACHED', 'You have reached the booking limit', detail),

  appointmentNotModifiable: (status: string) =>
    new DomainError(
      'ENGAGEMENT_NOT_MODIFIABLE',
      'This appointment can no longer be changed',
      `It is already ${status.toLowerCase().replace(/_/g, ' ')}.`,
    ),

  // ── ITR ────────────────────────────────────────────────────────────────────

  duplicateEngagement: (assessmentYear: string, formType: string) =>
    new DomainError(
      'DUPLICATE_ENGAGEMENT',
      'You already have a filing registered for this year',
      `There is a live ${formType} engagement for ${assessmentYear}. Cancel it first if you want to start over.`,
    ),

  engagementNotModifiable: (status: string) =>
    new DomainError(
      'ENGAGEMENT_NOT_MODIFIABLE',
      'This engagement can no longer be changed',
      `It is already ${status.toLowerCase().replace(/_/g, ' ')}.`,
    ),

  illegalTransition: (from: string, to: string) =>
    new DomainError(
      'ENGAGEMENT_NOT_MODIFIABLE',
      'That status change is not allowed',
      `${from} cannot become ${to}.`,
    ),
} as const;
