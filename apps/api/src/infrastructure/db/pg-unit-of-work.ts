import type { Pool, PoolClient } from './pool.js';
import type { Querier } from './querier.js';
import type { Repositories, UnitOfWork } from '../../application/ports/unit-of-work.js';
import { PgUserRepository } from './repositories/user-repository.js';
import { PgCaProfileRepository } from './repositories/ca-profile-repository.js';
import { PgServiceRepository } from './repositories/service-repository.js';
import { PgAvailabilityRepository } from './repositories/availability-repository.js';
import { PgAppointmentRepository } from './repositories/appointment-repository.js';
import { PgItrEngagementRepository } from './repositories/itr-engagement-repository.js';
import { PgMessageRepository } from './repositories/message-repository.js';
import { PgContactEnquiryRepository } from './repositories/contact-enquiry-repository.js';
import { PgNotificationOutbox } from './repositories/notification-outbox.js';
import { PgAuditLog } from './repositories/audit-log.js';

export function buildRepositories(querier: Querier): Repositories {
  return {
    users: new PgUserRepository(querier),
    caProfile: new PgCaProfileRepository(querier),
    services: new PgServiceRepository(querier),
    availability: new PgAvailabilityRepository(querier),
    appointments: new PgAppointmentRepository(querier),
    itrEngagements: new PgItrEngagementRepository(querier),
    messages: new PgMessageRepository(querier),
    contactEnquiries: new PgContactEnquiryRepository(querier),
    outbox: new PgNotificationOutbox(querier),
    audit: new PgAuditLog(querier),
  };
}

/**
 * Real transactions.
 *
 * `transaction` takes a dedicated client out of the pool, wraps the work in
 * BEGIN/COMMIT, and hands the callback a fresh set of repositories bound to
 * that client. Everything the callback writes goes through the same
 * connection, so it commits or rolls back as one.
 *
 * Nested calls join the outer transaction rather than opening a second one —
 * a use case calling another use case must not end up half-committed.
 */
export class PgUnitOfWork implements UnitOfWork {
  readonly repos: Repositories;
  private depth = 0;
  private current: PoolClient | null = null;

  constructor(private readonly pool: Pool) {
    this.repos = buildRepositories(pool);
  }

  async transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    if (this.current) {
      // Already inside one. Savepoints would let the inner block roll back
      // independently, but no use case here wants that, and pretending
      // otherwise would hide partial failures.
      this.depth += 1;
      try {
        return await work(buildRepositories(this.current));
      } finally {
        this.depth -= 1;
      }
    }

    const client = await this.pool.connect();
    this.current = client;

    try {
      await client.query('begin');
      const result = await work(buildRepositories(client));
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // A rollback failure means the connection is already broken; the
        // original error is the one worth propagating.
      }
      throw error;
    } finally {
      this.current = null;
      this.depth = 0;
      client.release();
    }
  }
}
