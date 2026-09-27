import { describe, expect, it } from 'vitest';
import {
  canReply,
  canStartThread,
  hasLiveEngagement,
  nextThreadStatus,
} from '../../src/domain/messaging/messaging-policy.js';
import type { MessagingSubject } from '../../src/domain/messaging/messaging-policy.js';

function subject(over: Partial<MessagingSubject> = {}): MessagingSubject {
  return { blocked: false, profileComplete: true, engagements: [], ...over };
}

describe('canStartThread', () => {
  it('refuses a user with no engagements at all', () => {
    expect(canStartThread(subject())).toBeErr('NO_ENGAGEMENT');
  });

  it('allows a user with a confirmed appointment', () => {
    expect(
      canStartThread(subject({ engagements: [{ kind: 'APPOINTMENT', status: 'CONFIRMED' }] })),
    ).toBeOk();
  });

  it('allows a user with a registered ITR engagement', () => {
    expect(canStartThread(subject({ engagements: [{ kind: 'ITR', status: 'SUBMITTED' }] })))
      .toBeOk();
  });

  it('allows a user whose only appointment is long finished', () => {
    // Following up after a consultation is exactly what the practice wants to
    // field. Locking it out pushes that conversation to email, where the CA
    // loses the context.
    expect(
      canStartThread(subject({ engagements: [{ kind: 'APPOINTMENT', status: 'COMPLETED' }] })),
    ).toBeOk();
  });

  it('refuses a user whose only engagement was cancelled', () => {
    expect(
      canStartThread(
        subject({ engagements: [{ kind: 'APPOINTMENT', status: 'CANCELLED_BY_USER' }] }),
      ),
    ).toBeErr('NO_ENGAGEMENT');
  });

  it('refuses when every engagement is cancelled, by either party', () => {
    expect(
      canStartThread(
        subject({
          engagements: [
            { kind: 'APPOINTMENT', status: 'CANCELLED_BY_USER' },
            { kind: 'ITR', status: 'CANCELLED_BY_ADMIN' },
          ],
        }),
      ),
    ).toBeErr('NO_ENGAGEMENT');
  });

  it('allows when one engagement survives among cancelled ones', () => {
    expect(
      canStartThread(
        subject({
          engagements: [
            { kind: 'APPOINTMENT', status: 'CANCELLED_BY_USER' },
            { kind: 'ITR', status: 'IN_PROGRESS' },
          ],
        }),
      ),
    ).toBeOk();
  });

  it('refuses a blocked account before anything else', () => {
    expect(
      canStartThread(
        subject({ blocked: true, engagements: [{ kind: 'ITR', status: 'IN_PROGRESS' }] }),
      ),
    ).toBeErr('ACCOUNT_BLOCKED');
  });

  it('refuses an incomplete profile', () => {
    expect(
      canStartThread(
        subject({ profileComplete: false, engagements: [{ kind: 'ITR', status: 'IN_PROGRESS' }] }),
      ),
    ).toBeErr('PROFILE_INCOMPLETE');
  });

  it('gives a refusal that points at the contact form', () => {
    const result = canStartThread(subject());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.detail).toMatch(/contact form/i);
    }
  });
});

describe('hasLiveEngagement', () => {
  it('is false for an empty history', () => {
    expect(hasLiveEngagement(subject())).toBe(false);
  });

  it('is true for any non-cancelled engagement', () => {
    expect(hasLiveEngagement(subject({ engagements: [{ kind: 'ITR', status: 'FILED' }] }))).toBe(true);
  });
});

describe('canReply', () => {
  const thread = { ownerId: 'u1', status: 'AWAITING_USER' };

  it('lets the owner reply even with no live engagement', () => {
    // The engagement may have been cancelled — often that cancellation is what
    // they are discussing.
    expect(canReply({ blocked: false }, thread, 'u1', false)).toBeOk();
  });

  it('lets an admin reply to anyone', () => {
    expect(canReply({ blocked: false }, thread, 'admin', true)).toBeOk();
  });

  it('hides another user’s thread behind a 404, not a 403', () => {
    // A 403 confirms the thread exists. A 404 does not.
    expect(canReply({ blocked: false }, thread, 'u2', false)).toBeErr('NOT_FOUND');
  });

  it('refuses a blocked account', () => {
    expect(canReply({ blocked: true }, thread, 'u1', false)).toBeErr('ACCOUNT_BLOCKED');
  });
});

describe('nextThreadStatus', () => {
  it('passes the ball to the other side', () => {
    expect(nextThreadStatus('USER')).toBe('AWAITING_ADMIN');
    expect(nextThreadStatus('ADMIN')).toBe('AWAITING_USER');
  });
});
