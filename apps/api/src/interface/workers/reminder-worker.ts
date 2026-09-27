import type { Clock } from '../../application/ports/clock.js';
import type { UnitOfWork } from '../../application/ports/unit-of-work.js';

/**
 * A safety net, not the primary mechanism.
 *
 * Reminders are written as future-dated outbox rows at booking time, so the
 * normal path needs nothing here at all. This sweep exists for the edge cases
 * that path cannot cover: an appointment created directly in the database, a
 * migration that back-filled bookings, or a row whose reminder was somehow
 * never enqueued.
 *
 * `dedupeKey` makes it harmless to run — re-enqueuing a reminder that already
 * exists is a no-op at the storage layer.
 */
export class ReminderWorker {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deps: {
      uow: UnitOfWork;
      clock: Clock;
      logger?: { info(msg: string): void };
    },
  ) {}

  start(intervalMs = 30 * 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep();
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async sweep(): Promise<number> {
    const { uow, clock } = this.deps;
    const now = clock.now();

    // Appointments starting between 23 and 25 hours from now: wide enough
    // that a half-hour sweep cannot miss one, narrow enough to stay cheap.
    const from = new Date(now.getTime() + 23 * 3_600_000);
    const to = new Date(now.getTime() + 25 * 3_600_000);

    const appointments = await uow.repos.appointments.findNeedingReminder(from, to);
    const profile = await uow.repos.caProfile.find();

    let enqueued = 0;

    for (const appointment of appointments) {
      // eslint-disable-next-line no-await-in-loop
      await uow.repos.outbox.enqueue({
        channel: 'EMAIL',
        recipient: appointment.userEmail,
        templateKey: 'appointment.reminder',
        payload: {
          reference: appointment.reference,
          serviceName: appointment.serviceName,
          startsAt: appointment.startsAt.toISOString(),
          meetingUrl: appointment.meetingUrl,
          clientName: appointment.userName,
          timezone: profile?.timezone ?? 'Asia/Kolkata',
        },
        dedupeKey: `apt:${appointment.id}:reminder`,
      });
      enqueued += 1;
    }

    return enqueued;
  }
}
