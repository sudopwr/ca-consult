import type { RenderedEmail } from './templates.js';

export interface EmailSender {
  send(input: { to: string; email: RenderedEmail }): Promise<void>;
}

export interface SmsSender {
  send(input: { to: string; body: string }): Promise<void>;
}

/** Resend. Chosen for a simple API and good deliverability without a contract. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(input: { to: string; email: RenderedEmail }): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [input.to],
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
      }),
    });

    if (!response.ok) {
      // Thrown, not swallowed: the outbox worker decides whether to retry or
      // give up, and it needs the reason to record.
      throw new Error(`Resend rejected the message (${response.status}): ${await response.text()}`);
    }
  }
}

/** Development and tests: prints instead of sending. */
export class ConsoleEmailSender implements EmailSender {
  readonly sent: Array<{ to: string; subject: string }> = [];

  async send(input: { to: string; email: RenderedEmail }): Promise<void> {
    this.sent.push({ to: input.to, subject: input.email.subject });
    // eslint-disable-next-line no-console
    console.warn(`[email] to=${input.to} subject="${input.email.subject}"`);
  }
}

/**
 * MSG91 for Indian transactional SMS.
 *
 * Written and ready, but not wired while NOTIFY_SMS_ENABLED is false. Sending
 * transactional SMS to Indian numbers requires TRAI DLT registration — a
 * registered entity, an approved sender header, and a pre-approved template
 * per message type. `flow_id` below is the DLT template id, which is why the
 * bodies in templates.ts are fixed strings with variable slots.
 */
export class Msg91SmsSender implements SmsSender {
  constructor(
    private readonly authKey: string,
    private readonly senderId: string,
    private readonly flowId: string,
  ) {}

  async send(input: { to: string; body: string }): Promise<void> {
    const response = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: this.authKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flow_id: this.flowId,
        sender: this.senderId,
        recipients: [{ mobiles: input.to.replace('+', ''), body: input.body }],
      }),
    });

    if (!response.ok) {
      throw new Error(`MSG91 rejected the message (${response.status})`);
    }
  }
}

/**
 * The v1 default. Every SMS call becomes a no-op, so turning SMS on later is
 * one environment variable and no code change.
 */
export class NoopSmsSender implements SmsSender {
  async send(): Promise<void> {
    // Intentionally does nothing: SMS stays dark until DLT templates clear.
  }
}
