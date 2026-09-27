import type { NotificationOutbox, OutboxEntry } from '../../application/ports/notification-outbox.js';
import type { Clock } from '../../application/ports/clock.js';
import type { EmailSender, SmsSender } from '../../infrastructure/notifications/senders.js';
import { renderEmail, renderSms } from '../../infrastructure/notifications/templates.js';

export interface OutboxWorkerDeps {
  outbox: NotificationOutbox;
  email: EmailSender;
  sms: SmsSender;
  clock: Clock;
  batchSize?: number;
  maxAttempts?: number;
  logger?: { info(msg: string): void; error(msg: string): void };
}

/**
 * Drains the transactional outbox.
 *
 * The use cases never send anything themselves — they write a row in the same
 * transaction as the business change, and this worker delivers it afterwards.
 * That removes both failure modes of sending inline: an appointment saved with
 * no confirmation sent, and a confirmation sent for a booking that rolled back.
 *
 * Retries back off exponentially. After `maxAttempts` a row goes to DEAD
 * rather than looping forever — a permanently bad address should show up on
 * the dashboard, not consume the queue.
 */
export class OutboxWorker {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: OutboxWorkerDeps) {}

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    // Do not hold the process open for the sake of the poll timer.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One pass. Returns how many entries were delivered. */
  async tick(): Promise<number> {
    if (this.running) return 0; // never overlap passes
    this.running = true;

    try {
      const now = this.deps.clock.now();
      const batch = await this.deps.outbox.claimBatch(this.deps.batchSize ?? 20, now);

      let delivered = 0;
      for (const entry of batch) {
        // eslint-disable-next-line no-await-in-loop
        if (await this.deliver(entry)) delivered += 1;
      }
      return delivered;
    } finally {
      this.running = false;
    }
  }

  private async deliver(entry: OutboxEntry): Promise<boolean> {
    const { outbox, email, sms, clock } = this.deps;
    const maxAttempts = this.deps.maxAttempts ?? 5;

    try {
      if (entry.channel === 'EMAIL') {
        await email.send({ to: entry.recipient, email: renderEmail(entry.templateKey, entry.payload) });
      } else {
        const body = renderSms(entry.templateKey, entry.payload);
        // A template with no SMS variant is a successful no-op, not a failure.
        if (body) await sms.send({ to: entry.recipient, body });
      }

      await outbox.markSent(entry.id, clock.now());
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (entry.attempts >= maxAttempts) {
        await outbox.markDead(entry.id, message);
        this.deps.logger?.error(
          `outbox entry ${entry.id} (${entry.templateKey}) gave up after ${entry.attempts} attempts: ${message}`,
        );
        return false;
      }

      // 1m, 4m, 9m, 16m, 25m — quadratic, so a provider outage is retried
      // often at first and then left alone.
      const delayMs = Math.min(entry.attempts ** 2 * 60_000, 30 * 60_000);
      await outbox.markFailed(entry.id, message, new Date(clock.now().getTime() + delayMs));
      return false;
    }
  }
}
