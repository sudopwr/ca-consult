import type { Result } from '../shared/result.js';
import { err, ok } from '../shared/result.js';
import { Errors } from '../shared/errors.js';
import type { DomainError } from '../shared/domain-error.js';

export interface CaProfile {
  readonly fullName: string;
  readonly headline: string | null;
  readonly membershipNumber: string | null;
  readonly firmName: string | null;
  readonly bio: string | null;
  readonly photoUrl: string | null;
  readonly yearsExperience: number | null;
  readonly qualifications: readonly string[];
  readonly specialisations: readonly string[];
  readonly languages: readonly string[];
  readonly officeAddress: string | null;
  readonly googleMapsUrl: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly whatsappNumber: string | null;
  readonly linkedinUrl: string | null;
  /** Never exposed publicly — that would let anyone walk into the CA's room. */
  readonly defaultMeetingUrl: string | null;
  readonly timezone: string;
  readonly isPublished: boolean;
  readonly updatedAt: Date;
}

/**
 * Bookings confirm instantly, so the confirmation email leaves within seconds
 * and has to carry a working join link. A profile with no meeting room cannot
 * be published — the database enforces this too, but checking here gives the
 * admin a field-level message instead of a constraint violation.
 */
export function assertPublishable(profile: {
  isPublished: boolean;
  defaultMeetingUrl: string | null;
}): Result<void, DomainError> {
  if (profile.isPublished && !profile.defaultMeetingUrl) {
    return err(
      Errors.validation(
        'Add a meeting room link before publishing',
        'Bookings confirm instantly, so the confirmation email needs a link to send clients to.',
      ),
    );
  }
  return ok();
}

/**
 * The meeting link is snapshotted onto each appointment at booking time, so
 * changing the default later does not silently rewrite links already sent out.
 */
export function meetingUrlForBooking(profile: CaProfile): Result<string, DomainError> {
  if (!profile.defaultMeetingUrl) {
    return err(
      Errors.validation(
        'Online booking is not available right now',
        'The practice has not set up a meeting room yet.',
      ),
    );
  }
  return ok(profile.defaultMeetingUrl);
}
