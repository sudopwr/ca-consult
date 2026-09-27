import type { AppointmentRepository } from './appointment-repository.js';
import type { ItrEngagementRepository } from './itr-engagement-repository.js';
import type { UserRepository } from './user-repository.js';
import type { ServiceRepository } from './service-repository.js';
import type { AvailabilityRepository } from './availability-repository.js';
import type { CaProfileRepository } from './ca-profile-repository.js';
import type { MessageRepository } from './message-repository.js';
import type { ContactEnquiryRepository } from './contact-enquiry-repository.js';
import type { NotificationOutbox } from './notification-outbox.js';
import type { AuditLog } from './audit-log.js';

/**
 * Every repository, bound to one transaction.
 *
 * This is why the API talks to Postgres directly rather than through
 * supabase-js: booking an appointment writes the appointment, its status
 * history and three outbox rows, and either all of that happens or none of it
 * does. A REST client with no transaction API cannot express that, and the
 * failure mode — an appointment saved with no confirmation email, or an email
 * for a booking that rolled back — is exactly the kind of thing nobody notices
 * until a client turns up to a meeting that is not in the calendar.
 */
export interface Repositories {
  readonly users: UserRepository;
  readonly caProfile: CaProfileRepository;
  readonly services: ServiceRepository;
  readonly availability: AvailabilityRepository;
  readonly appointments: AppointmentRepository;
  readonly itrEngagements: ItrEngagementRepository;
  readonly messages: MessageRepository;
  readonly contactEnquiries: ContactEnquiryRepository;
  readonly outbox: NotificationOutbox;
  readonly audit: AuditLog;
}

export interface UnitOfWork {
  /**
   * Run `work` inside a transaction. Throwing rolls everything back; returning
   * commits. Nested calls join the outer transaction rather than opening a new
   * one, so a use case calling another use case stays atomic.
   */
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;

  /** Repositories outside any transaction, for reads. */
  readonly repos: Repositories;
}
