import { describe, expect, it } from 'vitest';
import {
  ITR_TERMINAL,
  ITR_TRANSITIONS,
  checkItrTransition,
  isItrTerminal,
  isItrTransitionAllowed,
  itrProgress,
  itrStatusLabel,
} from '../../src/domain/itr/itr-engagement.js';
import type { ItrEngagement, ItrStatus } from '../../src/domain/itr/itr-engagement.js';
import type { ActorRole } from '../../src/domain/appointment/appointment.js';

function engagement(over: Partial<ItrEngagement> = {}): ItrEngagement {
  return {
    id: 'e1',
    reference: 'ITR-2026-000001',
    userId: 'u1',
    serviceId: 's1',
    status: 'SUBMITTED',
    assessmentYear: 'AY 2026-27',
    itrFormType: 'ITR-1',
    serviceName: 'ITR-1 · Salaried',
    amountPaise: 99900,
    panNumber: null,
    hasBusinessIncome: false,
    userNotes: null,
    adminNotes: null,
    infoRequested: null,
    acknowledgementNumber: null,
    filedAt: null,
    cancellationReason: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: new Date('2026-09-16T09:00:00+05:30'),
    updatedAt: new Date('2026-09-16T09:00:00+05:30'),
    ...over,
  };
}

const ALL: ItrStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'INFO_REQUESTED',
  'IN_PROGRESS',
  'FILED',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
];
const ACTORS: ActorRole[] = ['USER', 'ADMIN', 'SYSTEM'];

describe('the ITR transition table', () => {
  it('agrees with isItrTerminal about dead ends', () => {
    for (const status of ALL) {
      const hasOutgoing = ITR_TRANSITIONS.some((t) => t.from === status);
      expect(isItrTerminal(status)).toBe(!hasOutgoing);
    }
  });

  it('rejects every pair not in the table', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        for (const actor of ACTORS) {
          const inTable = ITR_TRANSITIONS.some(
            (t) => t.from === from && t.to === to && t.actors.includes(actor),
          );
          expect(isItrTransitionAllowed(from, to, actor)).toBe(inTable);
        }
      }
    }
  });

  it('never lets a user drive the filing workflow', () => {
    for (const to of ['IN_REVIEW', 'IN_PROGRESS', 'FILED', 'COMPLETED'] as ItrStatus[]) {
      expect(isItrTransitionAllowed('SUBMITTED', to, 'USER')).toBe(false);
    }
  });

  it('lets IN_REVIEW and INFO_REQUESTED ping-pong', () => {
    expect(isItrTransitionAllowed('IN_REVIEW', 'INFO_REQUESTED', 'ADMIN')).toBe(true);
    expect(isItrTransitionAllowed('INFO_REQUESTED', 'IN_REVIEW', 'ADMIN')).toBe(true);
  });

  it('lets the CA go back and ask for more once work has started', () => {
    expect(isItrTransitionAllowed('IN_PROGRESS', 'INFO_REQUESTED', 'ADMIN')).toBe(true);
  });
});

describe('user cancellation', () => {
  it.each([['SUBMITTED'], ['IN_REVIEW'], ['INFO_REQUESTED']])(
    'is allowed from %s',
    (status) => {
      expect(
        checkItrTransition({
          engagement: engagement({ status: status as ItrStatus }),
          to: 'CANCELLED_BY_USER',
          actor: 'USER',
        }),
      ).toBeOk();
    },
  );

  it('is refused once work is in progress', () => {
    // Cancelling a return the CA has already started is a conversation, not a
    // button — the work has real cost by then.
    expect(
      checkItrTransition({
        engagement: engagement({ status: 'IN_PROGRESS' }),
        to: 'CANCELLED_BY_USER',
        actor: 'USER',
      }),
    ).toBeErr('ENGAGEMENT_NOT_MODIFIABLE');
  });

  it('is refused once the return has been filed', () => {
    expect(
      checkItrTransition({
        engagement: engagement({ status: 'FILED', acknowledgementNumber: '123' }),
        to: 'CANCELLED_BY_USER',
        actor: 'USER',
      }),
    ).toBeErr('ENGAGEMENT_NOT_MODIFIABLE');
  });
});

describe('admin guards', () => {
  it('refuses INFO_REQUESTED with no text', () => {
    expect(
      checkItrTransition({
        engagement: engagement({ status: 'IN_REVIEW' }),
        to: 'INFO_REQUESTED',
        actor: 'ADMIN',
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('accepts INFO_REQUESTED with text', () => {
    expect(
      checkItrTransition({
        engagement: engagement({ status: 'IN_REVIEW' }),
        to: 'INFO_REQUESTED',
        actor: 'ADMIN',
        infoRequested: 'Please send your Form 16 and bank interest certificate.',
      }),
    ).toBeOk();
  });

  it('refuses FILED with no acknowledgement number', () => {
    expect(
      checkItrTransition({
        engagement: engagement({ status: 'IN_PROGRESS' }),
        to: 'FILED',
        actor: 'ADMIN',
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('accepts FILED with an acknowledgement number', () => {
    expect(
      checkItrTransition({
        engagement: engagement({ status: 'IN_PROGRESS' }),
        to: 'FILED',
        actor: 'ADMIN',
        acknowledgementNumber: '123456789012345',
      }),
    ).toBeOk();
  });

  it('refuses an admin cancellation with no reason', () => {
    expect(
      checkItrTransition({
        engagement: engagement({ status: 'IN_PROGRESS' }),
        to: 'CANCELLED_BY_ADMIN',
        actor: 'ADMIN',
      }),
    ).toBeErr('VALIDATION_FAILED');
  });

  it('refuses any change once the engagement is complete', () => {
    for (const status of ITR_TERMINAL) {
      expect(
        checkItrTransition({
          engagement: engagement({ status, acknowledgementNumber: '1' }),
          to: 'IN_REVIEW',
          actor: 'ADMIN',
        }),
      ).toBeErr('ENGAGEMENT_NOT_MODIFIABLE');
    }
  });

  it('refuses skipping straight from SUBMITTED to FILED', () => {
    expect(
      checkItrTransition({
        engagement: engagement({ status: 'SUBMITTED' }),
        to: 'FILED',
        actor: 'ADMIN',
        acknowledgementNumber: '123',
      }),
    ).toBeErr('ENGAGEMENT_NOT_MODIFIABLE');
  });
});

describe('client-facing presentation', () => {
  it('advances progress monotonically along the happy path', () => {
    const path: ItrStatus[] = ['SUBMITTED', 'IN_REVIEW', 'IN_PROGRESS', 'FILED', 'COMPLETED'];
    const values = path.map(itrProgress);

    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThan(values[i - 1]!);
    }
    expect(values.at(-1)).toBe(1);
  });

  it('does not advance progress when the CA asks for more information', () => {
    expect(itrProgress('INFO_REQUESTED')).toBe(itrProgress('IN_REVIEW'));
  });

  it('gives cancelled engagements no progress', () => {
    expect(itrProgress('CANCELLED_BY_USER')).toBe(0);
    expect(itrProgress('CANCELLED_BY_ADMIN')).toBe(0);
  });

  it('labels INFO_REQUESTED in terms of what the client must do', () => {
    expect(itrStatusLabel('INFO_REQUESTED')).toBe('Waiting on you');
  });

  it('has a label for every status', () => {
    for (const status of ALL) {
      expect(itrStatusLabel(status).length).toBeGreaterThan(0);
    }
  });
});
