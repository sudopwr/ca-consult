import type { FastifyInstance } from 'fastify';
import {
  availabilityQuerySchema,
  publicServiceListQuerySchema,
  submitContactEnquiryRequestSchema,
} from '@ca/contracts';
import { Errors } from '../../../domain/shared/errors.js';
import { unwrapOrThrow } from '../result-helpers.js';
import { toPublicCaProfile, toServiceJson } from '../serialisers.js';
import type { AppDeps } from '../dependencies.js';

/** Everything a visitor can reach without signing in. */
export async function registerPublicRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/public/ca-profile', async (_request, reply) => {
    const profile = await deps.manageCaProfile.findPublished();
    // Unpublished is indistinguishable from absent, on purpose: a half-written
    // profile should not be visible just because someone knows the URL.
    if (!profile) throw Errors.notFound('Profile');

    return reply.header('cache-control', 'public, max-age=120').send(toPublicCaProfile(profile));
  });

  app.get('/public/services', async (request, reply) => {
    const query = publicServiceListQuerySchema.parse(request.query);
    const services = await deps.manageServices.listPublic(query.kind);

    return reply
      .header('cache-control', 'public, max-age=120')
      .send(services.map(toServiceJson));
  });

  app.get('/public/availability', async (request, reply) => {
    const query = availabilityQuerySchema.parse(request.query);

    const result = unwrapOrThrow(
      await deps.listAvailableSlots.execute({
        serviceId: query.serviceId,
        from: query.from,
        to: query.to,
      }),
    );

    return reply
      // Short, but enough that a client clicking between dates does not hammer
      // the slot generator. Slots go stale quickly, so no longer than a minute.
      .header('cache-control', 'public, max-age=60')
      .send({
        serviceId: result.serviceId,
        timezone: result.timezone,
        days: result.days.map((day) => ({
          date: day.date,
          slots: day.slots.map((slot) => ({
            startsAt: slot.start.toISOString(),
            endsAt: slot.end.toISOString(),
          })),
        })),
      });
  });

  app.post(
    '/public/contact-enquiries',
    {
      config: {
        // Third of the four defences (honeypot, dwell time, captcha are the
        // others). Tight because a genuine visitor sends one message, not four.
        rateLimit: { max: 3, timeWindow: '1 hour' },
      },
    },
    async (request, reply) => {
      const body = submitContactEnquiryRequestSchema.parse(request.body);

      await deps.submitContactEnquiry.execute({
        name: body.name,
        email: body.email,
        phone: body.phone ?? null,
        subject: body.subject,
        body: body.body,
        captchaToken: body.captchaToken,
        honeypot: body.website ?? '',
        renderedAt: body.renderedAt ?? null,
        sourceIp: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      // Always 202, always the same body — whether the enquiry was stored,
      // dropped as spam, or failed the captcha. A bot that cannot tell the
      // difference cannot tune itself until it gets through.
      return reply.code(202).send({ accepted: true });
    },
  );
}
