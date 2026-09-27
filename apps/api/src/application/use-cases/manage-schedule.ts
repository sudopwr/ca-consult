import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { AvailabilityRule } from '../../domain/scheduling/availability-rule.js';
import type { ScheduleException } from '../../domain/scheduling/schedule-exception.js';
import type { LocalDate } from '../../domain/shared/time.js';
import { addDays, zonedToInstant } from '../../domain/shared/time.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import type {
  CreateScheduleExceptionInput,
  UpsertAvailabilityRuleInput,
} from '../ports/availability-repository.js';

export interface ScheduleConflict {
  readonly appointmentId: string;
  readonly reference: string;
  readonly startsAt: Date;
  readonly userName: string | null;
  readonly userEmail: string;
}

export class ManageAvailability {
  constructor(private readonly deps: { uow: UnitOfWork }) {}

  async listRules(): Promise<AvailabilityRule[]> {
    return this.deps.uow.repos.availability.listRules();
  }

  async createRule(input: UpsertAvailabilityRuleInput): Promise<AvailabilityRule> {
    return this.deps.uow.repos.availability.createRule(input);
  }

  async updateRule(
    id: string,
    input: UpsertAvailabilityRuleInput,
  ): Promise<Result<AvailabilityRule, DomainError>> {
    const existing = await this.deps.uow.repos.availability.findRule(id);
    if (!existing) return err(Errors.notFound('Availability rule'));
    return ok(await this.deps.uow.repos.availability.updateRule(id, input));
  }

  async deleteRule(id: string): Promise<Result<void, DomainError>> {
    const existing = await this.deps.uow.repos.availability.findRule(id);
    if (!existing) return err(Errors.notFound('Availability rule'));
    await this.deps.uow.repos.availability.deleteRule(id);
    return ok();
  }

  async listExceptions(from: LocalDate): Promise<ScheduleException[]> {
    return this.deps.uow.repos.availability.listUpcomingExceptions(from);
  }

  /**
   * Blocking a date with confirmed appointments on it is allowed — the CA may
   * well be blocking it *because* something came up — but they are handed the
   * list of appointments they have just orphaned, so they can cancel or move
   * them deliberately rather than discovering it on the day.
   */
  async createException(
    input: CreateScheduleExceptionInput,
  ): Promise<Result<{ exception: ScheduleException; conflicts: ScheduleConflict[] }, DomainError>> {
    const { uow } = this.deps;

    const profile = await uow.repos.caProfile.find();
    const timezone = profile?.timezone ?? 'Asia/Kolkata';

    let conflicts: ScheduleConflict[] = [];

    if (input.kind === 'BLOCKED') {
      const from = input.startTime
        ? zonedToInstant(input.onDate, input.startTime, timezone)
        : zonedToInstant(input.onDate, '00:00', timezone);
      const to = input.endTime
        ? zonedToInstant(input.onDate, input.endTime, timezone)
        : zonedToInstant(addDays(input.onDate, 1), '00:00', timezone);

      const affected = await uow.repos.appointments.findConfirmedInRange(from, to);

      conflicts = affected.map((a) => ({
        appointmentId: a.id,
        reference: a.reference,
        startsAt: a.startsAt,
        userName: a.userName,
        userEmail: a.userEmail,
      }));
    }

    const exception = await uow.repos.availability.createException(input);
    return ok({ exception, conflicts });
  }

  async deleteException(id: string): Promise<Result<void, DomainError>> {
    await this.deps.uow.repos.availability.deleteException(id);
    return ok();
  }
}
