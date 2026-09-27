import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { Service, ServiceKind } from '../../domain/service/service.js';
import type { CaProfile } from '../../domain/ca-profile/ca-profile.js';
import { assertPublishable } from '../../domain/ca-profile/ca-profile.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import type { UpsertServiceInput } from '../ports/service-repository.js';
import type { UpsertCaProfileInput } from '../ports/ca-profile-repository.js';

export class ManageCaProfile {
  constructor(private readonly deps: { uow: UnitOfWork }) {}

  async find(): Promise<CaProfile | null> {
    return this.deps.uow.repos.caProfile.find();
  }

  /** The landing page's source. Returns null while unpublished, so the route 404s. */
  async findPublished(): Promise<CaProfile | null> {
    const profile = await this.deps.uow.repos.caProfile.find();
    return profile?.isPublished ? profile : null;
  }

  async upsert(
    input: UpsertCaProfileInput,
    adminId: string,
  ): Promise<Result<CaProfile, DomainError>> {
    // Bookings confirm instantly, so a published page must already have a room
    // to send clients to. The database enforces this as well; checking here
    // gives the admin a field-level message instead of a constraint violation.
    const publishable = assertPublishable(input);
    if (!publishable.ok) return publishable;

    const profile = await this.deps.uow.transaction(async (repos) => {
      const saved = await repos.caProfile.upsert(input);
      await repos.audit.record({
        actorId: adminId,
        action: 'ca_profile.updated',
        entityType: 'ca_profile',
        entityId: 'singleton',
        diff: { isPublished: input.isPublished },
      });
      return saved;
    });

    return ok(profile);
  }
}

export class ManageServices {
  constructor(private readonly deps: { uow: UnitOfWork }) {}

  async listPublic(kind?: ServiceKind): Promise<Service[]> {
    return this.deps.uow.repos.services.listActive(kind);
  }

  async listAll(kind?: ServiceKind): Promise<Service[]> {
    return this.deps.uow.repos.services.listAll(kind);
  }

  async create(input: UpsertServiceInput, adminId: string): Promise<Result<Service, DomainError>> {
    const clash = await this.deps.uow.repos.services.findBySlug(input.slug);
    if (clash) return err(Errors.validation('Another service already uses that link'));

    const service = await this.deps.uow.transaction(async (repos) => {
      const created = await repos.services.create(input);
      await repos.audit.record({
        actorId: adminId,
        action: 'service.created',
        entityType: 'service',
        entityId: created.id,
        diff: { name: created.name, amountPaise: created.amountPaise },
      });
      return created;
    });

    return ok(service);
  }

  async update(
    id: string,
    input: UpsertServiceInput,
    adminId: string,
  ): Promise<Result<Service, DomainError>> {
    const existing = await this.deps.uow.repos.services.findById(id);
    if (!existing) return err(Errors.notFound('Service'));

    const clash = await this.deps.uow.repos.services.findBySlug(input.slug);
    if (clash && clash.id !== id) {
      return err(Errors.validation('Another service already uses that link'));
    }

    // Changing the kind would leave existing appointments or engagements
    // pointing at a service that cannot explain them.
    if (existing.kind !== input.kind) {
      const referenced = await this.deps.uow.repos.services.isReferenced(id);
      if (referenced) {
        return err(
          Errors.validation(
            'This service already has bookings, so its type cannot change',
            'Deactivate it and create a new one instead.',
          ),
        );
      }
    }

    const service = await this.deps.uow.transaction(async (repos) => {
      const updated = await repos.services.update(id, input);
      await repos.audit.record({
        actorId: adminId,
        action: 'service.updated',
        entityType: 'service',
        entityId: id,
        diff: {
          amountPaiseFrom: existing.amountPaise,
          amountPaiseTo: updated.amountPaise,
          isActive: updated.isActive,
        },
      });
      return updated;
    });

    return ok(service);
  }

  /**
   * Deleting a service that history points at would orphan appointments whose
   * price and name were snapshotted from it. Deactivate instead — it vanishes
   * from the landing page and nothing breaks.
   */
  async remove(id: string, adminId: string): Promise<Result<{ deactivated: boolean }, DomainError>> {
    const existing = await this.deps.uow.repos.services.findById(id);
    if (!existing) return err(Errors.notFound('Service'));

    const referenced = await this.deps.uow.repos.services.isReferenced(id);

    await this.deps.uow.transaction(async (repos) => {
      if (referenced) {
        await repos.services.deactivate(id);
      } else {
        await repos.services.hardDelete(id);
      }
      await repos.audit.record({
        actorId: adminId,
        action: referenced ? 'service.deactivated' : 'service.deleted',
        entityType: 'service',
        entityId: id,
      });
    });

    return ok({ deactivated: referenced });
  }
}
