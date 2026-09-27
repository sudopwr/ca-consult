import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import type { Appointment, ActorRole } from '../../domain/appointment/appointment.js';
import { checkTransition } from '../../domain/appointment/appointment.js';
import type { BookingPolicy } from '../../domain/appointment/booking-policy.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import type { EnqueueInput } from '../ports/notification-outbox.js';

export interface CancelAppointmentInput {
  readonly appointmentId: string;
  readonly actorId: string;
  readonly actorRole: ActorRole;
  readonly reason: string;
}

export class CancelAppointment {
  constructor(
    private readonly deps: { uow: UnitOfWork; clock: Clock; policy: BookingPolicy },
  ) {}

  async execute(input: CancelAppointmentInput): Promise<Result<Appointment, DomainError>> {
    const { uow, clock, policy } = this.deps;
    const now = clock.now();

    const appointment = await uow.repos.appointments.findByIdWithUser(input.appointmentId);
    if (!appointment) return err(Errors.notFound('Appointment'));

    // A user asking about someone else's appointment gets a 404, not a 403 —
    // a 403 would confirm it exists.
    if (input.actorRole === 'USER' && appointment.userId !== input.actorId) {
      return err(Errors.notFound('Appointment'));
    }

    const to = input.actorRole === 'ADMIN' ? 'CANCELLED_BY_ADMIN' : 'CANCELLED_BY_USER';

    const check = checkTransition({
      appointment,
      to,
      actor: input.actorRole,
      now,
      policy,
      reason: input.reason,
    });
    if (!check.ok) return check;

    const updated = await uow.transaction(async (repos) => {
      const result = await repos.appointments.updateStatus({
        id: appointment.id,
        status: to,
        cancellationReason: input.reason,
        cancelledAt: now,
      });

      await repos.appointments.recordStatusChange({
        appointmentId: appointment.id,
        fromStatus: appointment.status,
        toStatus: to,
        changedBy: input.actorId,
        actorRole: input.actorRole,
        note: input.reason,
      });

      const payload = {
        reference: appointment.reference,
        serviceName: appointment.serviceName,
        startsAt: appointment.startsAt.toISOString(),
        reason: input.reason,
        cancelledBy: input.actorRole === 'ADMIN' ? 'the CA' : 'you',
        clientName: appointment.userName,
        clientEmail: appointment.userEmail,
      };

      // Typed explicitly: without it TypeScript narrows the array to the first
      // element's literal template key and rejects the admin notice below.
      const entries: EnqueueInput[] = [
        {
          channel: 'EMAIL',
          recipient: appointment.userEmail,
          templateKey: 'appointment.cancelled',
          payload,
          dedupeKey: `apt:${appointment.id}:cancelled`,
        },
      ];

      // Tell the CA only when the client initiated it — they already know
      // about their own cancellations.
      if (input.actorRole === 'USER') {
        const adminEmails = await repos.users.findAdminEmails();
        for (const email of adminEmails) {
          entries.push({
            channel: 'EMAIL',
            recipient: email,
            templateKey: 'admin.appointment.cancelled_by_user',
            payload,
            dedupeKey: `apt:${appointment.id}:cancelled:admin:${email}`,
          });
        }
      }

      await repos.outbox.enqueueMany(entries);
      return result;
    });

    return ok(updated);
  }
}
