import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { ItrEngagement, ItrStatus } from '../../domain/itr/itr-engagement.js';
import { checkItrTransition, itrStatusLabel } from '../../domain/itr/itr-engagement.js';
import type { ActorRole } from '../../domain/appointment/appointment.js';
import { maskPan, normalisePan } from '../../domain/user/pan-number.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface AdvanceItrEngagementInput {
  readonly engagementId: string;
  readonly actorId: string;
  readonly actorRole: ActorRole;
  readonly status?: ItrStatus | undefined;
  readonly infoRequested?: string | null | undefined;
  readonly acknowledgementNumber?: string | null | undefined;
  readonly panNumber?: string | null | undefined;
  readonly adminNotes?: string | null | undefined;
  readonly cancellationReason?: string | null | undefined;
}

/**
 * Moves an engagement through the filing workflow, and is the only path that
 * can record a PAN.
 */
export class AdvanceItrEngagement {
  constructor(private readonly deps: { uow: UnitOfWork; clock: Clock }) {}

  async execute(input: AdvanceItrEngagementInput): Promise<Result<ItrEngagement, DomainError>> {
    const { uow, clock } = this.deps;
    const now = clock.now();

    const engagement = await uow.repos.itrEngagements.findByIdWithUser(input.engagementId);
    if (!engagement) return err(Errors.notFound('Engagement'));

    if (input.actorRole === 'USER' && engagement.userId !== input.actorId) {
      return err(Errors.notFound('Engagement'));
    }

    // Only an admin may touch a PAN, and only through this route.
    let pan: string | null | undefined;
    if (input.panNumber !== undefined) {
      if (input.actorRole !== 'ADMIN') return err(Errors.forbidden());
      if (input.panNumber === null) {
        pan = null;
      } else {
        pan = normalisePan(input.panNumber);
        if (!pan) return err(Errors.validation('A PAN looks like ABCDE1234F'));
      }
    }

    if (input.status) {
      const check = checkItrTransition({
        engagement,
        to: input.status,
        actor: input.actorRole,
        infoRequested: input.infoRequested,
        acknowledgementNumber: input.acknowledgementNumber,
        cancellationReason: input.cancellationReason,
      });
      if (!check.ok) return check;
    }

    const updated = await uow.transaction(async (repos) => {
      let current: ItrEngagement = engagement;

      if (input.adminNotes !== undefined || pan !== undefined) {
        current = await repos.itrEngagements.updateAdminFields({
          id: engagement.id,
          ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
          ...(pan !== undefined ? { panNumber: pan } : {}),
        });
      }

      if (input.status) {
        current = await repos.itrEngagements.updateStatus({
          id: engagement.id,
          status: input.status,
          ...(input.status === 'INFO_REQUESTED'
            ? { infoRequested: input.infoRequested ?? null }
            : {}),
          ...(input.status === 'FILED'
            ? { acknowledgementNumber: input.acknowledgementNumber ?? null, filedAt: now }
            : {}),
          ...(input.status === 'COMPLETED' ? { completedAt: now } : {}),
          ...(input.status.startsWith('CANCELLED')
            ? { cancellationReason: input.cancellationReason ?? null, cancelledAt: now }
            : {}),
        });

        await repos.itrEngagements.recordStatusChange({
          engagementId: engagement.id,
          fromStatus: engagement.status,
          toStatus: input.status,
          changedBy: input.actorId,
          actorRole: input.actorRole,
          note: input.infoRequested ?? input.cancellationReason ?? null,
        });

        await this.notify(repos, engagement, input, current);
      }

      if (input.actorRole === 'ADMIN') {
        await repos.audit.record({
          actorId: input.actorId,
          action: 'itr.updated',
          entityType: 'itr_engagement',
          entityId: engagement.id,
          // Masked. An unredacted PAN must never reach the audit table.
          diff: {
            status: input.status ?? null,
            panChanged: pan !== undefined,
            pan: pan !== undefined ? maskPan(pan) : undefined,
          },
        });
      }

      return current;
    });

    return ok(updated);
  }

  private async notify(
    repos: Parameters<Parameters<UnitOfWork['transaction']>[0]>[0],
    engagement: { id: string; reference: string; serviceName: string; userEmail: string; userName: string | null; assessmentYear: string },
    input: AdvanceItrEngagementInput,
    current: ItrEngagement,
  ): Promise<void> {
    const status = input.status!;

    // A user cancelling their own engagement does not need an email about it.
    if (status === 'CANCELLED_BY_USER') return;

    const payload = {
      reference: engagement.reference,
      serviceName: engagement.serviceName,
      assessmentYear: engagement.assessmentYear,
      status,
      statusLabel: itrStatusLabel(status),
      clientName: engagement.userName,
      infoRequested: current.infoRequested,
      acknowledgementNumber: current.acknowledgementNumber,
      reason: input.cancellationReason,
    };

    const templateKey =
      status === 'INFO_REQUESTED'
        ? 'itr.info_requested'
        : status === 'FILED'
          ? 'itr.filed'
          : status === 'CANCELLED_BY_ADMIN'
            ? 'itr.cancelled'
            : 'itr.status_changed';

    await repos.outbox.enqueue({
      channel: 'EMAIL',
      recipient: engagement.userEmail,
      templateKey,
      payload,
      // Includes the status so a later transition is a distinct send, but the
      // same transition twice is not.
      dedupeKey: `itr:${engagement.id}:${status}`,
    });
  }
}
