import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { ItrEngagement } from '../../domain/itr/itr-engagement.js';
import { assertCanEngage } from '../../domain/user/user-profile.js';
import { isRegistrable } from '../../domain/service/service.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import { DuplicateEngagementError } from '../ports/itr-engagement-repository.js';

export interface RegisterItrEngagementInput {
  readonly userId: string;
  readonly serviceId: string;
  readonly hasBusinessIncome: boolean;
  readonly notes: string | null;
  readonly idempotencyKey: string | null;
}

/**
 * ITR registration. Unlike booking, this does not auto-confirm: it lands as
 * SUBMITTED and the CA works it through the pipeline.
 *
 * Note what the input does not carry: a PAN. A government identifier does not
 * belong in a public form — the CA asks for it through INFO_REQUESTED once the
 * filing actually needs it.
 */
export class RegisterItrEngagement {
  constructor(private readonly deps: { uow: UnitOfWork }) {}

  async execute(
    input: RegisterItrEngagementInput,
  ): Promise<Result<ItrEngagement, DomainError>> {
    const { uow } = this.deps;

    if (input.idempotencyKey) {
      const existing = await uow.repos.itrEngagements.findByIdempotencyKey(
        input.userId,
        input.idempotencyKey,
      );
      if (existing) return ok(existing);
    }

    const user = await uow.repos.users.findById(input.userId);
    if (!user) return err(Errors.notFound('Account'));

    const canEngage = assertCanEngage(user);
    if (!canEngage.ok) return canEngage;

    const service = await uow.repos.services.findById(input.serviceId);
    if (!service || !isRegistrable(service)) {
      return err(Errors.notFound('Filing service', 'It may no longer be offered.'));
    }

    const assessmentYear = service.assessmentYear!;
    const formType = service.itrFormType!;

    // Checked here for a clean message; the partial unique index enforces it
    // for real, including against two requests racing.
    const live = await uow.repos.itrEngagements.findLiveFor(
      input.userId,
      assessmentYear,
      formType,
    );
    if (live) return err(Errors.duplicateEngagement(assessmentYear, formType));

    try {
      const engagement = await uow.transaction(async (repos) => {
        const created = await repos.itrEngagements.create({
          userId: input.userId,
          serviceId: service.id,
          assessmentYear,
          itrFormType: formType,
          serviceName: service.name,
          amountPaise: service.amountPaise,
          hasBusinessIncome: input.hasBusinessIncome,
          userNotes: input.notes,
          idempotencyKey: input.idempotencyKey,
        });

        await repos.itrEngagements.recordStatusChange({
          engagementId: created.id,
          fromStatus: null,
          toStatus: 'SUBMITTED',
          changedBy: input.userId,
          actorRole: 'USER',
          note: 'Registered online',
        });

        const adminEmails = await repos.users.findAdminEmails();

        const payload = {
          reference: created.reference,
          serviceName: created.serviceName,
          assessmentYear,
          formType,
          amountPaise: created.amountPaise,
          hasBusinessIncome: created.hasBusinessIncome,
          clientName: user.fullName,
          clientEmail: user.email,
          clientPhone: user.phone,
        };

        await repos.outbox.enqueueMany([
          {
            channel: 'EMAIL',
            recipient: user.email,
            templateKey: 'itr.registered',
            payload,
            dedupeKey: `itr:${created.id}:registered`,
          },
          ...adminEmails.map((email) => ({
            channel: 'EMAIL' as const,
            recipient: email,
            templateKey: 'admin.itr.registered' as const,
            payload,
            dedupeKey: `itr:${created.id}:admin:${email}`,
          })),
        ]);

        return created;
      });

      return ok(engagement);
    } catch (error) {
      if (error instanceof DuplicateEngagementError) {
        return err(Errors.duplicateEngagement(error.assessmentYear, error.formType));
      }
      throw error;
    }
  }
}
