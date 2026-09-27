import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { UserProfile, UserStatus } from '../../domain/user/user-profile.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import type { UserListQuery, UserListRow } from '../ports/user-repository.js';

export class ManageUsers {
  constructor(private readonly deps: { uow: UnitOfWork }) {}

  async list(query: UserListQuery): Promise<{ rows: UserListRow[]; total: number }> {
    return this.deps.uow.repos.users.list(query);
  }

  async find(id: string): Promise<Result<UserProfile, DomainError>> {
    const user = await this.deps.uow.repos.users.findById(id);
    return user ? ok(user) : err(Errors.notFound('Account'));
  }

  async setStatus(input: {
    userId: string;
    adminId: string;
    status: UserStatus;
    reason?: string | undefined;
  }): Promise<Result<void, DomainError>> {
    const user = await this.deps.uow.repos.users.findById(input.userId);
    if (!user) return err(Errors.notFound('Account'));

    // Locking out the only admin would leave the panel unreachable.
    if (user.role === 'ADMIN' && input.status === 'BLOCKED') {
      return err(Errors.validation('An administrator account cannot be suspended'));
    }

    await this.deps.uow.transaction(async (repos) => {
      await repos.users.setStatus(input.userId, input.status);
      await repos.audit.record({
        actorId: input.adminId,
        action: input.status === 'BLOCKED' ? 'user.blocked' : 'user.unblocked',
        entityType: 'user',
        entityId: input.userId,
        diff: { reason: input.reason ?? null },
      });
    });

    return ok();
  }

  /** Clears the no-show lockout so the client can book online again. */
  async resetNoShows(input: { userId: string; adminId: string }): Promise<Result<void, DomainError>> {
    const user = await this.deps.uow.repos.users.findById(input.userId);
    if (!user) return err(Errors.notFound('Account'));

    await this.deps.uow.transaction(async (repos) => {
      await repos.users.resetNoShowCount(input.userId);
      await repos.audit.record({
        actorId: input.adminId,
        action: 'user.no_shows_reset',
        entityType: 'user',
        entityId: input.userId,
        diff: { from: user.noShowCount },
      });
    });

    return ok();
  }
}
