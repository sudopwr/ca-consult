import type { FastifyInstance } from 'fastify';
import {
  bookAppointmentRequestSchema,
  cancelAppointmentRequestSchema,
  cancelItrEngagementRequestSchema,
  registerItrEngagementRequestSchema,
  rescheduleAppointmentRequestSchema,
} from '@ca/contracts';
import { Errors } from '../../../domain/shared/errors.js';
import { requireAuth, requireCompleteProfile } from '../guards/index.js';
import { unwrapOrThrow } from '../result-helpers.js';
import { toClientAppointment, toClientEngagement } from '../serialisers.js';
import type { AppDeps } from '../dependencies.js';

/** The header a client sends so a retry after a dropped response is safe. */
function idempotencyKey(request: { headers: Record<string, unknown> }): string | null {
  const value = request.headers['idempotency-key'];
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 200) : null;
}

export async function registerBookingRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post(
    '/appointments',
    // Tighter than the global limit: booking writes to the calendar, and a
    // script hammering this endpoint is never a genuine client.
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = requireCompleteProfile(request);
      const body = bookAppointmentRequestSchema.parse(request.body);

      const appointment = unwrapOrThrow(
        await deps.bookAppointment.execute({
          userId: user.id,
          serviceId: body.serviceId,
          startsAt: new Date(body.startsAt),
          notes: body.notes ?? null,
          idempotencyKey: idempotencyKey(request),
        }),
      );

      // 201 with a CONFIRMED appointment and a join link. There is no pending
      // state to explain, which is the whole point of auto-confirm.
      return reply.code(201).send(toClientAppointment(appointment, deps.clock.now()));
    },
  );

  app.get('/appointments/:id', async (request) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };

    const appointment = await deps.uow.repos.appointments.findById(id);
    if (!appointment || appointment.userId !== user.id) throw Errors.notFound('Appointment');

    return toClientAppointment(appointment, deps.clock.now());
  });

  app.post('/appointments/:id/cancel', async (request) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };
    const body = cancelAppointmentRequestSchema.parse(request.body);

    const appointment = unwrapOrThrow(
      await deps.cancelAppointment.execute({
        appointmentId: id,
        actorId: user.id,
        actorRole: 'USER',
        reason: body.reason,
      }),
    );

    return toClientAppointment(appointment, deps.clock.now());
  });

  app.post('/appointments/:id/reschedule', async (request) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };
    const body = rescheduleAppointmentRequestSchema.parse(request.body);

    const appointment = unwrapOrThrow(
      await deps.rescheduleAppointment.execute({
        appointmentId: id,
        actorId: user.id,
        actorRole: 'USER',
        startsAt: new Date(body.startsAt),
        notifyUser: true,
      }),
    );

    return toClientAppointment(appointment, deps.clock.now());
  });

  // ── ITR engagements ───────────────────────────────────────────────────────

  app.post(
    '/itr-engagements',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = requireCompleteProfile(request);
      const body = registerItrEngagementRequestSchema.parse(request.body);

      const engagement = unwrapOrThrow(
        await deps.registerItrEngagement.execute({
          userId: user.id,
          serviceId: body.serviceId,
          hasBusinessIncome: body.hasBusinessIncome,
          notes: body.notes ?? null,
          idempotencyKey: idempotencyKey(request),
        }),
      );

      return reply.code(201).send(toClientEngagement(engagement));
    },
  );

  app.get('/itr-engagements/:id', async (request) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };

    const engagement = await deps.uow.repos.itrEngagements.findById(id);
    if (!engagement || engagement.userId !== user.id) throw Errors.notFound('Engagement');

    return toClientEngagement(engagement);
  });

  app.post('/itr-engagements/:id/cancel', async (request) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };
    const body = cancelItrEngagementRequestSchema.parse(request.body);

    const engagement = unwrapOrThrow(
      await deps.advanceItrEngagement.execute({
        engagementId: id,
        actorId: user.id,
        actorRole: 'USER',
        status: 'CANCELLED_BY_USER',
        cancellationReason: body.reason,
      }),
    );

    return toClientEngagement(engagement);
  });
}
