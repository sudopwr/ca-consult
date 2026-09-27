import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { Address, UserProfile } from '../../domain/user/user-profile.js';
import { normaliseIndianPhone } from '../../domain/user/phone-number.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface CompleteUserProfileInput {
  readonly userId: string;
  readonly fullName: string;
  readonly phone: string;
  readonly address: Address;
}

/**
 * Onboarding. Google supplies an email and a display name; the practice needs
 * a number it can ring and an address for correspondence, so we ask once here
 * rather than chasing it when a return is half-prepared.
 */
export class CompleteUserProfile {
  constructor(private readonly deps: { uow: UnitOfWork; clock: Clock }) {}

  async execute(input: CompleteUserProfileInput): Promise<Result<UserProfile, DomainError>> {
    const { uow, clock } = this.deps;

    const user = await uow.repos.users.findById(input.userId);
    if (!user) return err(Errors.notFound('Account'));
    if (user.status === 'BLOCKED') return err(Errors.accountBlocked());

    // Users type "98765 43210"; SMS providers need "+919876543210".
    const phone = normaliseIndianPhone(input.phone);
    if (!phone) {
      return err(
        Errors.validation(
          'That phone number does not look right',
          'Enter a 10-digit Indian mobile number, or an international number starting with +.',
        ),
      );
    }

    const wasAlreadyComplete = user.profileCompletedAt !== null;
    const now = clock.now();

    const updated = await uow.transaction(async (repos) => {
      const profile = await repos.users.completeProfile({
        userId: input.userId,
        fullName: input.fullName.trim(),
        phone,
        address: {
          line1: input.address.line1.trim(),
          line2: input.address.line2?.trim() || null,
          city: input.address.city.trim(),
          state: input.address.state.trim(),
          pincode: input.address.pincode.trim(),
        },
        completedAt: user.profileCompletedAt ?? now,
      });

      // Welcome once, on first completion — not on every later edit.
      if (!wasAlreadyComplete) {
        await repos.outbox.enqueue({
          channel: 'EMAIL',
          recipient: profile.email,
          templateKey: 'user.welcome',
          payload: { clientName: profile.fullName },
          dedupeKey: `user:${profile.id}:welcome`,
        });
      }

      return profile;
    });

    return ok(updated);
  }
}
