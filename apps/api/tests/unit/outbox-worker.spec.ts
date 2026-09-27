import { describe, expect, it } from 'vitest';
import { OutboxWorker } from '../../src/interface/workers/outbox-worker.js';
import { InMemoryOutbox } from '../fakes/in-memory-repositories.js';
import { FakeClock } from '../fakes/fake-clock.js';
import type { EmailSender, SmsSender } from '../../src/infrastructure/notifications/senders.js';

class RecordingEmailSender implements EmailSender {
  readonly sent: Array<{ to: string; subject: string }> = [];
  failUntil = 0;
  private attempts = 0;

  async send(input: { to: string; email: { subject: string } }): Promise<void> {
    this.attempts += 1;
    if (this.attempts <= this.failUntil) throw new Error('provider unavailable');
    this.sent.push({ to: input.to, subject: input.email.subject });
  }
}

class RecordingSmsSender implements SmsSender {
  readonly sent: Array<{ to: string; body: string }> = [];
  async send(input: { to: string; body: string }): Promise<void> {
    this.sent.push(input);
  }
}

function build(overrides: { failUntil?: number; maxAttempts?: number } = {}) {
  const outbox = new InMemoryOutbox();
  const email = new RecordingEmailSender();
  const sms = new RecordingSmsSender();
  const clock = new FakeClock('2026-09-16T09:00:00+05:30');

  email.failUntil = overrides.failUntil ?? 0;

  const worker = new OutboxWorker({
    outbox,
    email,
    sms,
    clock,
    maxAttempts: overrides.maxAttempts ?? 5,
  });

  return { outbox, email, sms, clock, worker };
}

const CONFIRMED = {
  channel: 'EMAIL' as const,
  recipient: 'client@example.test',
  templateKey: 'appointment.confirmed' as const,
  payload: {
    reference: 'APT-2026-000001',
    serviceName: 'Tax Planning Consultation',
    startsAt: '2026-09-20T05:30:00.000Z',
    meetingUrl: 'https://meet.example/room',
    amountPaise: 149900,
    clientName: 'Ananya',
  },
};

describe('OutboxWorker', () => {
  it('delivers a pending entry and marks it sent', async () => {
    const { outbox, email, worker } = build();
    await outbox.enqueue({ ...CONFIRMED, dedupeKey: 'apt:1:confirmed' });

    expect(await worker.tick()).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.subject).toMatch(/Confirmed: Tax Planning Consultation/);
    expect((await outbox.counts()).pending).toBe(0);
  });

  it('does not deliver a future-dated entry before its time', async () => {
    // This is how 24-hour reminders work: written at booking time, invisible
    // to the worker until their moment arrives.
    const { outbox, email, clock, worker } = build();

    await outbox.enqueue({
      ...CONFIRMED,
      templateKey: 'appointment.reminder',
      dedupeKey: 'apt:1:reminder',
      scheduledFor: new Date('2026-09-19T05:30:00.000Z'),
    });

    expect(await worker.tick()).toBe(0);
    expect(email.sent).toHaveLength(0);

    clock.set('2026-09-19T06:00:00.000Z');
    expect(await worker.tick()).toBe(1);
    expect(email.sent).toHaveLength(1);
  });

  it('refuses to enqueue the same dedupe key twice', async () => {
    const { outbox, email, worker } = build();

    await outbox.enqueue({ ...CONFIRMED, dedupeKey: 'apt:1:confirmed' });
    await outbox.enqueue({ ...CONFIRMED, dedupeKey: 'apt:1:confirmed' });

    await worker.tick();
    // A retried use case must not email the client twice.
    expect(email.sent).toHaveLength(1);
  });

  it('retries a failure with backoff rather than giving up', async () => {
    const { outbox, email, worker, clock } = build({ failUntil: 2 });
    await outbox.enqueue({ ...CONFIRMED, dedupeKey: 'apt:1:confirmed' });

    expect(await worker.tick()).toBe(0);
    expect(outbox.entries[0]!.attempts).toBe(1);
    expect(outbox.entries[0]!.lastError).toMatch(/provider unavailable/);

    clock.advanceHours(1);
    expect(await worker.tick()).toBe(0);

    clock.advanceHours(1);
    expect(await worker.tick()).toBe(1);
    expect(email.sent).toHaveLength(1);
  });

  it('gives up after the attempt ceiling instead of looping forever', async () => {
    // A permanently bad address should surface on the dashboard, not consume
    // the queue indefinitely.
    const { outbox, worker, clock } = build({ failUntil: 99, maxAttempts: 2 });
    await outbox.enqueue({ ...CONFIRMED, dedupeKey: 'apt:1:confirmed' });

    for (let i = 0; i < 4; i += 1) {
      await worker.tick();
      clock.advanceHours(1);
    }

    expect((await outbox.counts()).dead).toBe(1);
  });

  it('treats a template with no SMS variant as a successful no-op', async () => {
    const { outbox, sms, worker } = build();

    await outbox.enqueue({
      channel: 'SMS',
      recipient: '+919876543210',
      templateKey: 'user.welcome',
      payload: {},
      dedupeKey: 'user:1:welcome:sms',
    });

    expect(await worker.tick()).toBe(1);
    expect(sms.sent).toHaveLength(0);
    expect((await outbox.counts()).pending).toBe(0);
  });

  it('sends an SMS for a template that has one', async () => {
    const { outbox, sms, worker } = build();

    await outbox.enqueue({
      channel: 'SMS',
      recipient: '+919876543210',
      templateKey: 'appointment.confirmed',
      payload: CONFIRMED.payload,
      dedupeKey: 'apt:1:confirmed:sms',
    });

    await worker.tick();
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.body).toMatch(/confirmed/i);
  });

  it('does not run two passes at once', async () => {
    const { outbox, worker } = build();
    await outbox.enqueue({ ...CONFIRMED, dedupeKey: 'apt:1:confirmed' });

    const [first, second] = await Promise.all([worker.tick(), worker.tick()]);
    expect(first + second).toBe(1);
  });
});
