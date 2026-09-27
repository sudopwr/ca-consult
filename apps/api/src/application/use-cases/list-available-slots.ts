import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import { generateSlots, MAX_QUERY_DAYS } from '../../domain/scheduling/slot-generator.js';
import type { DaySlots } from '../../domain/scheduling/slot-generator.js';
import { isBookable } from '../../domain/service/service.js';
import { addDays, daysBetween, zonedToInstant } from '../../domain/shared/time.js';
import type { LocalDate } from '../../domain/shared/time.js';
import type { BookingPolicy } from '../../domain/appointment/booking-policy.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface ListAvailableSlotsInput {
  readonly serviceId: string;
  readonly from: LocalDate;
  readonly to: LocalDate;
}

export interface AvailabilityResult {
  readonly serviceId: string;
  readonly timezone: string;
  readonly days: DaySlots[];
}

export class ListAvailableSlots {
  constructor(
    private readonly deps: {
      uow: UnitOfWork;
      clock: Clock;
      policy: BookingPolicy;
    },
  ) {}

  async execute(input: ListAvailableSlotsInput): Promise<Result<AvailabilityResult, DomainError>> {
    const { uow, clock, policy } = this.deps;

    const span = daysBetween(input.from, input.to);
    if (span < 0) return err(Errors.validation('The end date is before the start date'));
    if (span >= MAX_QUERY_DAYS) {
      return err(
        Errors.validation(`Ask for at most ${MAX_QUERY_DAYS} days at a time`),
      );
    }

    const service = await uow.repos.services.findById(input.serviceId);
    if (!service || !isBookable(service)) return err(Errors.notFound('Service'));

    const profile = await uow.repos.caProfile.find();
    if (!profile) return ok({ serviceId: service.id, timezone: 'Asia/Kolkata', days: [] });

    const timezone = profile.timezone;

    // Widen the busy window by a day either side: an appointment that starts
    // the evening before can still overlap the first slot of the range.
    const busyFrom = zonedToInstant(addDays(input.from, -1), '00:00', timezone);
    const busyTo = zonedToInstant(addDays(input.to, 2), '00:00', timezone);

    const [rules, exceptions, busy] = await Promise.all([
      uow.repos.availability.listRules(),
      uow.repos.availability.listExceptions(input.from, input.to),
      uow.repos.appointments.findBusyRanges(busyFrom, busyTo),
    ]);

    const days = generateSlots(
      {
        from: input.from,
        to: input.to,
        durationMinutes: service.durationMinutes!,
        timeZone: timezone,
        now: clock.now(),
      },
      {
        rules,
        exceptions,
        busy,
        policy: { minLeadMinutes: policy.minLeadMinutes, maxAdvanceDays: policy.maxAdvanceDays },
      },
    );

    return ok({ serviceId: service.id, timezone, days });
  }
}
