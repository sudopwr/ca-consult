import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';
import { Errors } from '../shared/errors.js';
import type { DomainError } from '../shared/domain-error.js';
import type { ActorRole } from '../appointment/appointment.js';

export type ItrStatus =
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'INFO_REQUESTED'
  | 'IN_PROGRESS'
  | 'FILED'
  | 'COMPLETED'
  | 'CANCELLED_BY_USER'
  | 'CANCELLED_BY_ADMIN';

export const ITR_TERMINAL: readonly ItrStatus[] = [
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
];

/**
 * A user may back out while the engagement is still paperwork. Once the CA has
 * started the return, cancelling is a conversation, not a button.
 */
export const ITR_USER_CANCELLABLE: readonly ItrStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'INFO_REQUESTED',
];

export function isItrTerminal(status: ItrStatus): boolean {
  return ITR_TERMINAL.includes(status);
}

export interface ItrEngagement {
  readonly id: string;
  readonly reference: string;
  readonly userId: string;
  readonly serviceId: string;
  readonly status: ItrStatus;
  readonly assessmentYear: string;
  readonly itrFormType: string;
  readonly serviceName: string;
  readonly amountPaise: number;
  readonly panNumber: string | null;
  readonly hasBusinessIncome: boolean;
  readonly userNotes: string | null;
  readonly adminNotes: string | null;
  readonly infoRequested: string | null;
  readonly acknowledgementNumber: string | null;
  readonly filedAt: Date | null;
  readonly cancellationReason: string | null;
  readonly cancelledAt: Date | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ItrTransition {
  readonly from: ItrStatus;
  readonly to: ItrStatus;
  readonly actors: readonly ActorRole[];
}

/**
 * The filing workflow. IN_REVIEW and INFO_REQUESTED ping-pong, which is the
 * normal shape of "I need your Form 16" followed by "here it is".
 */
export const ITR_TRANSITIONS: readonly ItrTransition[] = [
  { from: 'SUBMITTED', to: 'IN_REVIEW', actors: ['ADMIN'] },
  { from: 'SUBMITTED', to: 'IN_PROGRESS', actors: ['ADMIN'] },
  { from: 'IN_REVIEW', to: 'INFO_REQUESTED', actors: ['ADMIN'] },
  { from: 'IN_REVIEW', to: 'IN_PROGRESS', actors: ['ADMIN'] },
  { from: 'INFO_REQUESTED', to: 'IN_REVIEW', actors: ['ADMIN'] },
  { from: 'INFO_REQUESTED', to: 'IN_PROGRESS', actors: ['ADMIN'] },
  { from: 'IN_PROGRESS', to: 'FILED', actors: ['ADMIN'] },
  { from: 'IN_PROGRESS', to: 'INFO_REQUESTED', actors: ['ADMIN'] },
  { from: 'FILED', to: 'COMPLETED', actors: ['ADMIN'] },

  { from: 'SUBMITTED', to: 'CANCELLED_BY_USER', actors: ['USER'] },
  { from: 'IN_REVIEW', to: 'CANCELLED_BY_USER', actors: ['USER'] },
  { from: 'INFO_REQUESTED', to: 'CANCELLED_BY_USER', actors: ['USER'] },

  { from: 'SUBMITTED', to: 'CANCELLED_BY_ADMIN', actors: ['ADMIN'] },
  { from: 'IN_REVIEW', to: 'CANCELLED_BY_ADMIN', actors: ['ADMIN'] },
  { from: 'INFO_REQUESTED', to: 'CANCELLED_BY_ADMIN', actors: ['ADMIN'] },
  { from: 'IN_PROGRESS', to: 'CANCELLED_BY_ADMIN', actors: ['ADMIN'] },
];

export function isItrTransitionAllowed(
  from: ItrStatus,
  to: ItrStatus,
  actor: ActorRole,
): boolean {
  return ITR_TRANSITIONS.some((t) => t.from === from && t.to === to && t.actors.includes(actor));
}

export interface ItrTransitionInput {
  readonly engagement: ItrEngagement;
  readonly to: ItrStatus;
  readonly actor: ActorRole;
  readonly infoRequested?: string | null;
  readonly acknowledgementNumber?: string | null;
  readonly cancellationReason?: string | null;
}

export function checkItrTransition(input: ItrTransitionInput): Result<void, DomainError> {
  const { engagement, to, actor, infoRequested, acknowledgementNumber, cancellationReason } = input;

  if (isItrTerminal(engagement.status)) {
    return err(Errors.engagementNotModifiable(engagement.status));
  }

  if (!isItrTransitionAllowed(engagement.status, to, actor)) {
    // A user trying to cancel work already in progress is the common case here,
    // and deserves a better message than "illegal transition".
    if (to === 'CANCELLED_BY_USER' && actor === 'USER') {
      return err(
        Errors.engagementNotModifiable(engagement.status),
      );
    }
    return err(Errors.illegalTransition(engagement.status, to));
  }

  switch (to) {
    case 'INFO_REQUESTED':
      if (!infoRequested || infoRequested.trim().length === 0) {
        return err(
          Errors.validation('Say what you need from the client — they see this text'),
        );
      }
      return ok();

    case 'FILED':
      if (!acknowledgementNumber || acknowledgementNumber.trim().length === 0) {
        return err(
          Errors.validation('Record the acknowledgement number when marking a return filed'),
        );
      }
      return ok();

    case 'CANCELLED_BY_ADMIN':
      if (!cancellationReason || cancellationReason.trim().length === 0) {
        return err(Errors.validation('Give a reason — the client is told why'));
      }
      return ok();

    default:
      return ok();
  }
}

/** Progress for the client-facing tracker, 0-1. Cancelled engagements have none. */
export function itrProgress(status: ItrStatus): number {
  switch (status) {
    case 'SUBMITTED':
      return 0.15;
    case 'IN_REVIEW':
      return 0.35;
    case 'INFO_REQUESTED':
      return 0.35;
    case 'IN_PROGRESS':
      return 0.6;
    case 'FILED':
      return 0.9;
    case 'COMPLETED':
      return 1;
    default:
      return 0;
  }
}

export function itrStatusLabel(status: ItrStatus): string {
  switch (status) {
    case 'SUBMITTED':
      return 'Registered';
    case 'IN_REVIEW':
      return 'Under review';
    case 'INFO_REQUESTED':
      return 'Waiting on you';
    case 'IN_PROGRESS':
      return 'Being prepared';
    case 'FILED':
      return 'Filed';
    case 'COMPLETED':
      return 'Complete';
    case 'CANCELLED_BY_USER':
      return 'Cancelled by you';
    case 'CANCELLED_BY_ADMIN':
      return 'Cancelled by the CA';
  }
}
