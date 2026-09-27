import type { FastifyInstance } from 'fastify';
import {
  completeProfileRequestSchema,
  myEngagementsQuerySchema,
  postMessageRequestSchema,
  startThreadRequestSchema,
} from '@ca/contracts';
import { Errors } from '../../../domain/shared/errors.js';
import { requireAuth, requireCompleteProfile } from '../guards/index.js';
import { unwrapOrThrow } from '../result-helpers.js';
import { toClientAppointment, toClientEngagement, toPublicUser } from '../serialisers.js';
import { userCanMessage } from '../../../application/use-cases/messaging.js';
import type { AppDeps } from '../dependencies.js';

export async function registerMeRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  /**
   * One call that tells the app shell everything it needs to route: whether to
   * send the user to onboarding, whether to show the admin nav, and whether
   * the message box or the contact form belongs in the sidebar.
   */
  app.get('/me', async (request) => {
    const user = requireAuth(request);

    const [canMessage, unread] = await Promise.all([
      userCanMessage(deps.uow, user.id),
      deps.uow.repos.messages.countUnreadForUser(user.id),
    ]);

    return {
      profile: toPublicUser(user),
      profileComplete: user.profileCompletedAt !== null,
      isAdmin: user.role === 'ADMIN',
      canMessage,
      unreadMessages: unread,
    };
  });

  app.put('/me/profile', async (request) => {
    const user = requireAuth(request);
    const body = completeProfileRequestSchema.parse(request.body);

    const profile = unwrapOrThrow(
      await deps.completeUserProfile.execute({
        userId: user.id,
        fullName: body.fullName,
        phone: body.phone,
        address: {
          line1: body.address.line1,
          line2: body.address.line2 ?? null,
          city: body.address.city,
          state: body.address.state,
          pincode: body.address.pincode,
        },
      }),
    );

    return { profile: toPublicUser(profile), profileComplete: true };
  });

  /** Appointments and ITR engagements in one timeline. */
  app.get('/me/engagements', async (request) => {
    const user = requireAuth(request);
    const query = myEngagementsQuerySchema.parse(request.query);
    const now = deps.clock.now();

    const result = await deps.getMyEngagements.execute({ userId: user.id, scope: query.scope });

    return {
      canMessage: result.canMessage,
      items: result.items.map((item) =>
        item.kind === 'APPOINTMENT'
          ? {
              kind: 'APPOINTMENT' as const,
              sortAt: item.sortAt.toISOString(),
              appointment: toClientAppointment(item.appointment, now),
            }
          : {
              kind: 'ITR' as const,
              sortAt: item.sortAt.toISOString(),
              engagement: toClientEngagement(item.engagement),
            },
      ),
    };
  });

  // ── messaging ─────────────────────────────────────────────────────────────

  app.get('/me/threads', async (request) => {
    const user = requireAuth(request);
    const threads = await deps.uow.repos.messages.listThreadsForUser(user.id);

    return threads.map((thread) => ({
      id: thread.id,
      subject: thread.subject,
      status: thread.status,
      appointmentId: thread.appointmentId,
      engagementId: thread.engagementId,
      contextLabel: null,
      lastMessageAt: thread.lastMessageAt.toISOString(),
      lastMessagePreview: thread.lastMessagePreview,
      unread: thread.unreadForUser,
      createdAt: thread.createdAt.toISOString(),
    }));
  });

  /**
   * The gate. A visitor with a question uses the contact form; a client with
   * an engagement gets a real conversation. The 403 body carries a detail the
   * UI turns into a link to the form, so it is a signpost rather than a wall.
   */
  app.post('/me/threads', async (request, reply) => {
    const user = requireCompleteProfile(request);
    const body = startThreadRequestSchema.parse(request.body);

    const thread = unwrapOrThrow(
      await deps.startThread.execute({
        userId: user.id,
        subject: body.subject,
        body: body.body,
        appointmentId: body.appointmentId ?? null,
        engagementId: body.engagementId ?? null,
      }),
    );

    return reply.code(201).send({ id: thread.id, subject: thread.subject, status: thread.status });
  });

  app.get('/me/threads/:id', async (request) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };

    const thread = await deps.uow.repos.messages.findThread(id);
    // 404 rather than 403 — a 403 would confirm the thread exists.
    if (!thread || thread.userId !== user.id) {
      throw Errors.notFound('Conversation');
    }

    const messages = await deps.uow.repos.messages.listMessages(id);
    await deps.markThreadRead.execute({ threadId: id, readerId: user.id, reader: 'USER' });

    return {
      id: thread.id,
      subject: thread.subject,
      status: thread.status,
      appointmentId: thread.appointmentId,
      engagementId: thread.engagementId,
      contextLabel: null,
      lastMessageAt: thread.lastMessageAt.toISOString(),
      lastMessagePreview: null,
      unread: 0,
      createdAt: thread.createdAt.toISOString(),
      messages: messages.map((message) => ({
        id: message.id,
        senderRole: message.senderRole,
        body: message.body,
        readAt: message.readAt?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString(),
      })),
    };
  });

  /**
   * Replying is deliberately NOT behind the engagement gate — see
   * MessagingPolicy. A cancelled appointment must not kill a conversation
   * that is often about the cancellation itself.
   */
  app.post('/me/threads/:id/messages', async (request, reply) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };
    const body = postMessageRequestSchema.parse(request.body);

    const message = unwrapOrThrow(
      await deps.postMessage.execute({
        threadId: id,
        senderId: user.id,
        senderRole: 'USER',
        body: body.body,
      }),
    );

    return reply.code(201).send({
      id: message.id,
      senderRole: message.senderRole,
      body: message.body,
      readAt: null,
      createdAt: message.createdAt.toISOString(),
    });
  });
}
