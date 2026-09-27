import type { Appointment } from '../../domain/appointment/appointment.js';
import type { ItrEngagement } from '../../domain/itr/itr-engagement.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import { userCanMessage } from './messaging.js';

export type EngagementItem =
  | { kind: 'APPOINTMENT'; sortAt: Date; appointment: Appointment }
  | { kind: 'ITR'; sortAt: Date; engagement: ItrEngagement };

export interface MyEngagements {
  readonly items: EngagementItem[];
  readonly canMessage: boolean;
}

/**
 * One timeline covering both kinds.
 *
 * Appointments and ITR engagements live in separate tables because they share
 * almost no invariants — but users think "my dealings with the CA", not "my
 * appointments table". The union is a read concern, so it lives here rather
 * than being forced into storage.
 */
export class GetMyEngagements {
  constructor(private readonly deps: { uow: UnitOfWork; clock: Clock }) {}

  async execute(input: {
    userId: string;
    scope: 'upcoming' | 'past' | 'all';
  }): Promise<MyEngagements> {
    const { uow, clock } = this.deps;
    const now = clock.now();

    const [appointments, engagements, canMessage] = await Promise.all([
      uow.repos.appointments.listForUser(input.userId),
      uow.repos.itrEngagements.listForUser(input.userId),
      userCanMessage(uow, input.userId),
    ]);

    const items: EngagementItem[] = [
      ...appointments.map((appointment) => ({
        kind: 'APPOINTMENT' as const,
        sortAt: appointment.startsAt,
        appointment,
      })),
      // An ITR engagement has no date to happen on, so it sorts by when it
      // last moved — which is what a client scanning the list cares about.
      ...engagements.map((engagement) => ({
        kind: 'ITR' as const,
        sortAt: engagement.updatedAt,
        engagement,
      })),
    ];

    const filtered = items.filter((item) => {
      if (input.scope === 'all') return true;

      if (item.kind === 'APPOINTMENT') {
        const upcoming =
          item.appointment.status === 'CONFIRMED' &&
          item.appointment.startsAt.getTime() >= now.getTime();
        return input.scope === 'upcoming' ? upcoming : !upcoming;
      }

      const live = !item.engagement.status.startsWith('CANCELLED') &&
        item.engagement.status !== 'COMPLETED';
      return input.scope === 'upcoming' ? live : !live;
    });

    // Anything still ahead reads best soonest-first; history reads best
    // newest-first.
    filtered.sort((a, b) =>
      input.scope === 'upcoming'
        ? a.sortAt.getTime() - b.sortAt.getTime()
        : b.sortAt.getTime() - a.sortAt.getTime(),
    );

    return { items: filtered, canMessage };
  }
}
