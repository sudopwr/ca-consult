import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';
import { Errors } from '../shared/errors.js';
import type { DomainError } from '../shared/domain-error.js';

/**
 * Who may open a thread with the CA.
 *
 * Messaging is for clients, not for the internet. A visitor with a question
 * uses the contact form; someone who has actually engaged the practice gets a
 * real conversation.
 */

export type EngagementKind = 'APPOINTMENT' | 'ITR';

export interface EngagementSnapshot {
  readonly kind: EngagementKind;
  /** Any status string from either machine — only "is it cancelled" matters here. */
  readonly status: string;
}

export interface MessagingSubject {
  readonly blocked: boolean;
  readonly profileComplete: boolean;
  readonly engagements: readonly EngagementSnapshot[];
}

function isCancelled(status: string): boolean {
  return status.startsWith('CANCELLED');
}

/**
 * A cancelled-only history does not qualify. A completed consultation from
 * last year does — following up afterwards is exactly what the practice wants
 * to field, and locking it out would push that conversation to email where the
 * CA loses the context.
 */
export function hasLiveEngagement(subject: MessagingSubject): boolean {
  return subject.engagements.some((e) => !isCancelled(e.status));
}

export function canStartThread(subject: MessagingSubject): Result<void, DomainError> {
  if (subject.blocked) return err(Errors.accountBlocked());
  if (!subject.profileComplete) return err(Errors.profileIncomplete());
  if (!hasLiveEngagement(subject)) return err(Errors.noEngagement());
  return ok();
}

/**
 * Replying is deliberately NOT gated on holding an engagement.
 *
 * Killing a half-finished conversation because the appointment was cancelled
 * looks tidy in a spec and is infuriating in practice — the cancellation is
 * often precisely what the two of them are discussing. Only the admin closing
 * the thread ends it, and even that reopens on a new message.
 */
export function canReply(
  subject: Pick<MessagingSubject, 'blocked'>,
  thread: { ownerId: string; status: string },
  actorId: string,
  isAdmin: boolean,
): Result<void, DomainError> {
  if (subject.blocked) return err(Errors.accountBlocked());
  if (!isAdmin && thread.ownerId !== actorId) {
    // 404 rather than 403 at the route: do not confirm the thread exists.
    return err(Errors.notFound('Conversation'));
  }
  return ok();
}

export type ThreadStatus = 'AWAITING_ADMIN' | 'AWAITING_USER' | 'CLOSED';

/**
 * Posting a message always moves the ball to the other side, and a message in
 * a closed thread reopens it — if someone has more to say, the practice wants
 * to hear it rather than silently swallow it.
 */
export function nextThreadStatus(senderRole: 'USER' | 'ADMIN'): ThreadStatus {
  return senderRole === 'USER' ? 'AWAITING_ADMIN' : 'AWAITING_USER';
}
