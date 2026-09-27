import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';
import { Errors } from '../shared/errors.js';
import type { DomainError } from '../shared/domain-error.js';

export type UserRole = 'USER' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'BLOCKED';

export interface Address {
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
}

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly address: Address | null;
  readonly avatarUrl: string | null;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly noShowCount: number;
  readonly profileCompletedAt: Date | null;
  readonly createdAt: Date;
}

export function isProfileComplete(profile: UserProfile): boolean {
  return profile.profileCompletedAt !== null;
}

export function isAdmin(profile: UserProfile): boolean {
  return profile.role === 'ADMIN';
}

/**
 * The gate every booking and registration passes through.
 *
 * Google gives us an email and a display name. A practice that is going to
 * file someone's tax return needs a phone number it can reach them on and an
 * address — so the app asks once, up front, rather than chasing it later.
 */
export function assertCanEngage(profile: UserProfile): Result<void, DomainError> {
  if (profile.status === 'BLOCKED') return err(Errors.accountBlocked());
  if (!isProfileComplete(profile)) return err(Errors.profileIncomplete());
  return ok();
}

/** Has the user supplied everything the completed-profile flag claims? */
export function hasRequiredFields(input: {
  fullName: string | null;
  phone: string | null;
  address: Address | null;
}): boolean {
  return Boolean(
    input.fullName?.trim() &&
      input.phone?.trim() &&
      input.address?.line1?.trim() &&
      input.address?.city?.trim() &&
      input.address?.state?.trim() &&
      input.address?.pincode?.trim(),
  );
}
