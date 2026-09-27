import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { Appointment } from '../../domain/appointment/appointment.js';
import type { BookingPolicy } from '../../domain/appointment/booking-policy.js';
import { describeRefusal, refuseBooking } from '../../domain/appointment/booking-policy.js';
import { assertCanEngage } from '../../domain/user/user-profile.js';
import { isBookable } from '../../domain/service/service.js';
import { meetingUrlForBooking } from '../../domain/ca-profile/ca-profile.js';
import { isBookableSlot } from '../../domain/scheduling/slot-generator.js';
import { instantToLocalDate, zonedToInstant } from '../../domain/shared/time.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import { SlotTakenError } from '../ports/appointment-repository.js';

export interface BookAppointmentInput {
  readonly userId: string;
  readonly serviceId: string;
  readonly startsAt: Date;
  readonly notes: string | null;
  readonly idempotencyKey: string | null;
}

export interface BookAppointmentDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly policy: BookingPolicy;
}

/**
 * The core transaction.
 *
 * Bookings auto-confirm, which shapes everything here: there is no admin
 * review to catch a bad booking, so every guard runs now; and the confirmation
 * email leaves within seconds, so the meeting link has to be resolved and
 * snapshotted before the transaction commits.
 */
export class BookAppointment {
  constructor(private readonly deps: BookAppointmentDeps) {}

  async execute(input: BookAppointmentInput): Promise<Result<Appointment, DomainError>> {
    const { uow, clock, policy } = this.deps;
    const now = clock.now();

    // Replaying the same Idempotency-Key returns the original booking rather
    // than a duplicate or an error — a retried request after a dropped
    // response must not create a second appointment.
    if (input.idempotencyKey) {
      const existing = await uow.repos.appointments.findByIdempotencyKey(
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
    if (!service || !isBookable(service)) {
      return err(Errors.notFound('Service', 'It may have been withdrawn.'));
    }

    const profile = await uow.repos.caProfile.find();
    if (!profile) return err(Errors.validation('Online booking is not available right now'));

    const meetingUrl = meetingUrlForBooking(profile);
    if (!meetingUrl.ok) return meetingUrl;

    // ── policy ────────────────────────────────────────────────────────────
    const dayStart = zonedToInstant(instantToLocalDate(now, profile.timezone), '00:00', profile.timezone);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const [upcomingCount, bookedTodayCount] = await Promise.all([
      uow.repos.appointments.countUpcomingForUser(input.userId, now),
      uow.repos.appointments.countCreatedForUserOnDay(input.userId, dayStart, dayEnd),
    ]);

    const refusal = refuseBooking(
      {
        startsAt: input.startsAt,
        now,
        upcomingCount,
        bookedTodayCount,
        noShowCount: user.noShowCount,
      },
      policy,
    );

    if (refusal) {
      if (refusal.reason === 'IN_THE_PAST') {
        return err(Errors.slotUnavailable(describeRefusal(refusal)));
      }
      if (refusal.reason === 'TOO_SOON' || refusal.reason === 'TOO_FAR') {
        return err(Errors.slotUnavailable(describeRefusal(refusal)));
      }
      if (refusal.reason === 'NO_SHOW_LOCKOUT') {
        return err(Errors.forbidden(describeRefusal(refusal)));
      }
      return err(Errors.bookingLimitReached(describeRefusal(refusal)));
    }

    // ── is this actually a slot? ──────────────────────────────────────────
    const date = instantToLocalDate(input.startsAt, profile.timezone);
    const durationMinutes = service.durationMinutes!;

    const [rules, exceptions, busy] = await Promise.all([
      uow.repos.availability.listRules(),
      uow.repos.availability.listExceptions(date, date),
      uow.repos.appointments.findBusyRanges(
        new Date(input.startsAt.getTime() - 86_400_000),
        new Date(input.startsAt.getTime() + 86_400_000),
      ),
    ]);

    const bookable = isBookableSlot(
      input.startsAt,
      { date, durationMinutes, timeZone: profile.timezone, now },
      {
        rules,
        exceptions,
        busy,
        policy: { minLeadMinutes: policy.minLeadMinutes, maxAdvanceDays: policy.maxAdvanceDays },
      },
    );

    // A hand-crafted POST for 10:07 is open time but not a slot. The grid is
    // part of the contract, not a convenience for the date picker.
    if (!bookable) {
      return err(Errors.slotUnavailable('Pick one of the times shown on the booking page.'));
    }

    const endsAt = new Date(input.startsAt.getTime() + durationMinutes * 60_000);

    // ── write ─────────────────────────────────────────────────────────────
    try {
      const appointment = await uow.transaction(async (repos) => {
        const created = await repos.appointments.create({
          userId: input.userId,
          serviceId: service.id,
          startsAt: input.startsAt,
          endsAt,
          meetingUrl: meetingUrl.value,
          serviceName: service.name,
          amountPaise: service.amountPaise,
          userNotes: input.notes,
          idempotencyKey: input.idempotencyKey,
        });

        await repos.appointments.recordStatusChange({
          appointmentId: created.id,
          fromStatus: null,
          toStatus: 'CONFIRMED',
          changedBy: input.userId,
          actorRole: 'USER',
          note: 'Booked online',
        });

        const adminEmails = await repos.users.findAdminEmails();

        const payload = {
          reference: created.reference,
          serviceName: created.serviceName,
          startsAt: created.startsAt.toISOString(),
          endsAt: created.endsAt.toISOString(),
          meetingUrl: created.meetingUrl,
          amountPaise: created.amountPaise,
          timezone: profile.timezone,
          clientName: user.fullName,
          clientEmail: user.email,
          clientPhone: user.phone,
        };

        await repos.outbox.enqueueMany([
          {
            channel: 'EMAIL',
            recipient: user.email,
            templateKey: 'appointment.confirmed',
            payload,
            dedupeKey: `apt:${created.id}:confirmed`,
          },
          // Written now, delivered later. The worker ignores it until its hour
          // comes — no cron job scanning for appointments, no missed reminders
          // if the scheduler was down for an afternoon.
          {
            channel: 'EMAIL',
            recipient: user.email,
            templateKey: 'appointment.reminder',
            payload,
            dedupeKey: `apt:${created.id}:reminder`,
            scheduledFor: new Date(created.startsAt.getTime() - 24 * 3_600_000),
          },
          ...adminEmails.map((email) => ({
            channel: 'EMAIL' as const,
            recipient: email,
            templateKey: 'admin.appointment.booked' as const,
            payload,
            dedupeKey: `apt:${created.id}:admin:${email}`,
          })),
        ]);

        return created;
      });

      return ok(appointment);
    } catch (error) {
      // Someone else committed the same slot between our check and our insert.
      // The exclusion constraint caught it; turn it into something the UI can
      // act on by refetching.
      if (error instanceof SlotTakenError) {
        return err(
          Errors.slotUnavailable('Someone else booked that time a moment ago. Pick another slot.'),
        );
      }
      throw error;
    }
  }
}
