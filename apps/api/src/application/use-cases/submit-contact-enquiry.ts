import type { Result } from '../../domain/shared/result.js';
import { ok } from '../../domain/shared/result.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import type { CaptchaVerifier } from '../ports/captcha-verifier.js';

export interface SubmitContactEnquiryInput {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly subject: string;
  readonly body: string;
  readonly captchaToken: string;
  /** The honeypot field. Any content means a bot filled the form. */
  readonly honeypot: string;
  readonly renderedAt: number | null;
  readonly sourceIp: string | null;
  readonly userAgent: string | null;
}

export type EnquiryOutcome = 'STORED' | 'DROPPED_HONEYPOT' | 'DROPPED_CAPTCHA' | 'DROPPED_TOO_FAST';

/** Submissions faster than this are automated. */
const MIN_DWELL_MS = 3_000;

/**
 * The way in for someone who has not engaged the practice yet.
 *
 * Every outcome is a success from the caller's point of view. A bot that can
 * tell a rejection from an acceptance can tune itself until it gets through;
 * one that always sees 202 learns nothing. The route returns the same body
 * regardless, and the outcome here exists only for metrics and tests.
 */
export class SubmitContactEnquiry {
  constructor(
    private readonly deps: { uow: UnitOfWork; clock: Clock; captcha: CaptchaVerifier },
  ) {}

  async execute(input: SubmitContactEnquiryInput): Promise<Result<EnquiryOutcome, DomainError>> {
    const { uow, clock, captcha } = this.deps;

    // 1. Honeypot — free, and catches the least sophisticated traffic.
    if (input.honeypot.trim().length > 0) return ok('DROPPED_HONEYPOT');

    // 2. Dwell time — also free. Nobody reads and completes a contact form in
    //    under three seconds.
    if (input.renderedAt !== null) {
      const dwell = clock.now().getTime() - input.renderedAt;
      if (dwell >= 0 && dwell < MIN_DWELL_MS) return ok('DROPPED_TOO_FAST');
    }

    // 3. Turnstile — the only check that costs a network round trip, so it
    //    runs last.
    const passed = await captcha.verify(input.captchaToken, input.sourceIp);
    if (!passed) return ok('DROPPED_CAPTCHA');

    await uow.transaction(async (repos) => {
      const enquiry = await repos.contactEnquiries.create({
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        phone: input.phone?.trim() || null,
        subject: input.subject.trim(),
        body: input.body.trim(),
        sourceIp: input.sourceIp,
        userAgent: input.userAgent,
      });

      const adminEmails = await repos.users.findAdminEmails();

      await repos.outbox.enqueueMany([
        {
          channel: 'EMAIL',
          recipient: enquiry.email,
          templateKey: 'contact.acknowledged',
          payload: { name: enquiry.name, subject: enquiry.subject },
          dedupeKey: `enquiry:${enquiry.id}:ack`,
        },
        ...adminEmails.map((email) => ({
          channel: 'EMAIL' as const,
          recipient: email,
          templateKey: 'admin.contact.received' as const,
          payload: {
            enquiryId: enquiry.id,
            name: enquiry.name,
            email: enquiry.email,
            phone: enquiry.phone,
            subject: enquiry.subject,
            body: enquiry.body,
          },
          dedupeKey: `enquiry:${enquiry.id}:admin:${email}`,
        })),
      ]);
    });

    return ok('STORED');
  }
}
