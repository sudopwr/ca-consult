import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { Appointment, ActorRole } from '../../domain/appointment/appointment.js';
import { checkTransition } from '../../domain/appointment/appointment.js';
import type { BookingPolicy } from '../../domain/appointment/booking-policy.js';
import { isBookableSlot } from '../../domain/scheduling/slot-generator.js';
import { instantToLocalDate } from '../../domain/shared/time.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import { SlotTakenError } from '../ports/appointment-repository.js';

export interface RescheduleAppointmentInput {
  readonly appointmentId: string;
  readonly actorId: string;
  readonly actorRole: ActorRole;
  readonly startsAt: Date;
  readonly notifyUser: boolean;
}

/**
 * Rescheduling creates a successor row rather than moving the original.
 *
 * Moving it in place would destroy the record of when the appointment
 * originally was — which is exactly what someone asks about when a client
 * complains they were never told. The old row goes to RESCHEDULED with
 * `supersededBy` pointing forward.
 */
export class RescheduleAppointment {
  constructor(
    private readonly deps: { uow: UnitOfWork; clock: Clock; policy: BookingPolicy },
  ) {}

  async execute(input: RescheduleAppointmentInput): Promise<Result<Appointment, DomainError>> {
    const { uow, clock, policy } = this.deps;
    const now = clock.now();

    const original = await uow.repos.appointments.findByIdWithUser(input.appointmentId);
    if (!original) return err(Errors.notFound('Appointment'));

    if (input.actorRole === 'USER' && original.userId !== input.actorId) {
      return err(Errors.notFound('Appointment'));
    }

    const check = checkTransition({
      appointment: original,
      to: 'RESCHEDULED',
      actor: input.actorRole,
      now,
      policy,
    });
    if (!check.ok) return check;

    const service = await uow.repos.services.findById(original.serviceId);
    if (!service?.durationMinutes) return err(Errors.notFound('Service'));

    const profile = await uow.repos.caProfile.find();
    if (!profile) return err(Errors.validation('Rescheduling is not available right now'));

    const date = instantToLocalDate(input.startsAt, profile.timezone);

    const [rules, exceptions, busy] = await Promise.all([
      uow.repos.availability.listRules(),
      uow.repos.availability.listExceptions(date, date),
      uow.repos.appointments.findBusyRanges(
        new Date(input.startsAt.getTime() - 86_400_000),
        new Date(input.startsAt.getTime() + 86_400_000),
      ),
    ]);

    // The original's own slot must not block its replacement — moving an
    // appointment by fifteen minutes would otherwise collide with itself.
    const busyExcludingSelf = busy.filter(
      (range) =>
        !(
          range.start.getTime() === original.startsAt.getTime() &&
          range.end.getTime() === original.endsAt.getTime()
        ),
    );

    // An admin may place a client outside the published lead time; a user may not.
    const effectivePolicy =
      input.actorRole === 'ADMIN'
        ? { minLeadMinutes: 0, maxAdvanceDays: 3650 }
        : { minLeadMinutes: policy.minLeadMinutes, maxAdvanceDays: policy.maxAdvanceDays };

    const bookable = isBookableSlot(
      input.startsAt,
      { date, durationMinutes: service.durationMinutes, timeZone: profile.timezone, now },
      { rules, exceptions, busy: busyExcludingSelf, policy: effectivePolicy },
    );

    if (!bookable) {
      return err(Errors.slotUnavailable('That time is not available. Pick another slot.'));
    }

    const endsAt = new Date(input.startsAt.getTime() + service.durationMinutes * 60_000);

    try {
      const successor = await uow.transaction(async (repos) => {
        const created = await repos.appointments.create({
          userId: original.userId,
          serviceId: original.serviceId,
          startsAt: input.startsAt,
          endsAt,
          meetingUrl: original.meetingUrl,
          serviceName: original.serviceName,
          amountPaise: original.amountPaise,
          userNotes: original.userNotes,
          idempotencyKey: null,
        });

        await repos.appointments.updateStatus({
          id: original.id,
          status: 'RESCHEDULED',
          supersededBy: created.id,
        });

        await repos.appointments.recordStatusChange({
          appointmentId: original.id,
          fromStatus: original.status,
          toStatus: 'RESCHEDULED',
          changedBy: input.actorId,
          actorRole: input.actorRole,
          note: `Moved to ${input.startsAt.toISOString()}`,
        });

        await repos.appointments.recordStatusChange({
          appointmentId: created.id,
          fromStatus: null,
          toStatus: 'CONFIRMED',
          changedBy: input.actorId,
          actorRole: input.actorRole,
          note: `Rescheduled from ${original.reference}`,
        });

        if (input.notifyUser) {
          const payload = {
            reference: created.reference,
            previousReference: original.reference,
            serviceName: created.serviceName,
            previousStartsAt: original.startsAt.toISOString(),
            startsAt: created.startsAt.toISOString(),
            endsAt: created.endsAt.toISOString(),
            meetingUrl: created.meetingUrl,
            timezone: profile.timezone,
            clientName: original.userName,
            movedBy: input.actorRole === 'ADMIN' ? 'the CA' : 'you',
          };

          await repos.outbox.enqueueMany([
            {
              channel: 'EMAIL',
              recipient: original.userEmail,
              templateKey: 'appointment.rescheduled',
              payload,
              dedupeKey: `apt:${created.id}:rescheduled`,
            },
            {
              channel: 'EMAIL',
              recipient: original.userEmail,
              templateKey: 'appointment.reminder',
              payload,
              dedupeKey: `apt:${created.id}:reminder`,
              scheduledFor: new Date(created.startsAt.getTime() - 24 * 3_600_000),
            },
          ]);
        }

        return created;
      });

      return ok(successor);
    } catch (error) {
      if (error instanceof SlotTakenError) {
        return err(Errors.slotUnavailable('Someone else booked that time a moment ago.'));
      }
      throw error;
    }
  }
}
