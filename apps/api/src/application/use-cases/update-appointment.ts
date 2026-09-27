import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { Appointment, AppointmentStatus } from '../../domain/appointment/appointment.js';
import { checkTransition, incrementsNoShowCount } from '../../domain/appointment/appointment.js';
import type { BookingPolicy } from '../../domain/appointment/booking-policy.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface UpdateAppointmentInput {
  readonly appointmentId: string;
  readonly adminId: string;
  readonly status?: Extract<AppointmentStatus, 'COMPLETED' | 'NO_SHOW' | 'CANCELLED_BY_ADMIN'> | undefined;
  readonly adminNotes?: string | null | undefined;
  readonly meetingUrl?: string | null | undefined;
  readonly cancellationReason?: string | null | undefined;
}

/** Admin-only edits: outcome, private notes, and the join link. */
export class UpdateAppointment {
  constructor(
    private readonly deps: { uow: UnitOfWork; clock: Clock; policy: BookingPolicy },
  ) {}

  async execute(input: UpdateAppointmentInput): Promise<Result<Appointment, DomainError>> {
    const { uow, clock, policy } = this.deps;
    const now = clock.now();

    const appointment = await uow.repos.appointments.findByIdWithUser(input.appointmentId);
    if (!appointment) return err(Errors.notFound('Appointment'));

    if (input.status) {
      const check = checkTransition({
        appointment,
        to: input.status,
        actor: 'ADMIN',
        now,
        policy,
        reason: input.cancellationReason,
      });
      if (!check.ok) return check;
    }

    const meetingUrlChanged =
      input.meetingUrl !== undefined &&
      input.meetingUrl !== null &&
      input.meetingUrl !== appointment.meetingUrl;

    const updated = await uow.transaction(async (repos) => {
      let current = appointment as Appointment;

      if (input.adminNotes !== undefined || input.meetingUrl !== undefined) {
        current = await repos.appointments.updateAdminFields({
          id: appointment.id,
          ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
          ...(input.meetingUrl !== undefined ? { meetingUrl: input.meetingUrl } : {}),
        });
      }

      if (input.status) {
        current = await repos.appointments.updateStatus({
          id: appointment.id,
          status: input.status,
          ...(input.status === 'CANCELLED_BY_ADMIN'
            ? { cancellationReason: input.cancellationReason ?? null, cancelledAt: now }
            : {}),
          ...(input.status === 'COMPLETED' ? { completedAt: now } : {}),
        });

        await repos.appointments.recordStatusChange({
          appointmentId: appointment.id,
          fromStatus: appointment.status,
          toStatus: input.status,
          changedBy: input.adminId,
          actorRole: 'ADMIN',
          note: input.cancellationReason ?? null,
        });

        // Three no-shows pauses online booking. This is the only place the
        // counter moves, which keeps the lockout auditable.
        if (incrementsNoShowCount(input.status)) {
          await repos.users.incrementNoShowCount(appointment.userId);
        }

        if (input.status === 'CANCELLED_BY_ADMIN') {
          await repos.outbox.enqueue({
            channel: 'EMAIL',
            recipient: appointment.userEmail,
            templateKey: 'appointment.cancelled',
            payload: {
              reference: appointment.reference,
              serviceName: appointment.serviceName,
              startsAt: appointment.startsAt.toISOString(),
              reason: input.cancellationReason,
              cancelledBy: 'the CA',
              clientName: appointment.userName,
            },
            dedupeKey: `apt:${appointment.id}:cancelled`,
          });
        }
      }

      // Changing the room after a confirmation has gone out means the client is
      // holding a stale link. Tell them.
      if (meetingUrlChanged && current.status === 'CONFIRMED') {
        await repos.outbox.enqueue({
          channel: 'EMAIL',
          recipient: appointment.userEmail,
          templateKey: 'appointment.meeting_url_changed',
          payload: {
            reference: appointment.reference,
            startsAt: appointment.startsAt.toISOString(),
            meetingUrl: input.meetingUrl,
            clientName: appointment.userName,
          },
          dedupeKey: `apt:${appointment.id}:url:${input.meetingUrl}`,
        });
      }

      await repos.audit.record({
        actorId: input.adminId,
        action: 'appointment.updated',
        entityType: 'appointment',
        entityId: appointment.id,
        diff: {
          status: input.status ?? null,
          meetingUrlChanged,
          adminNotesChanged: input.adminNotes !== undefined,
        },
      });

      return current;
    });

    return ok(updated);
  }
}
