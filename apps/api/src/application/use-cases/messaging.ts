import type { Result } from '../../domain/shared/result.js';
import { err, ok } from '../../domain/shared/result.js';
import { Errors } from '../../domain/shared/errors.js';
import type { DomainError } from '../../domain/shared/domain-error.js';
import { canReply, canStartThread, nextThreadStatus } from '../../domain/messaging/messaging-policy.js';
import type { EngagementSnapshot } from '../../domain/messaging/messaging-policy.js';
import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';
import type { Thread, ThreadMessage } from '../ports/message-repository.js';

/** Both kinds of engagement, flattened for the messaging gate. */
async function engagementSnapshots(
  uow: UnitOfWork,
  userId: string,
): Promise<EngagementSnapshot[]> {
  const [appointments, engagements] = await Promise.all([
    uow.repos.appointments.listForUser(userId),
    uow.repos.itrEngagements.listForUser(userId),
  ]);

  return [
    ...appointments.map((a) => ({ kind: 'APPOINTMENT' as const, status: a.status })),
    ...engagements.map((e) => ({ kind: 'ITR' as const, status: e.status })),
  ];
}

export async function userCanMessage(uow: UnitOfWork, userId: string): Promise<boolean> {
  const user = await uow.repos.users.findById(userId);
  if (!user) return false;

  return canStartThread({
    blocked: user.status === 'BLOCKED',
    profileComplete: user.profileCompletedAt !== null,
    engagements: await engagementSnapshots(uow, userId),
  }).ok;
}

export interface StartThreadInput {
  readonly userId: string;
  readonly subject: string;
  readonly body: string;
  readonly appointmentId: string | null;
  readonly engagementId: string | null;
}

export class StartThread {
  constructor(private readonly deps: { uow: UnitOfWork; clock: Clock }) {}

  async execute(input: StartThreadInput): Promise<Result<Thread, DomainError>> {
    const { uow, clock } = this.deps;

    const user = await uow.repos.users.findById(input.userId);
    if (!user) return err(Errors.notFound('Account'));

    // This is the gate. A visitor with a question uses the contact form; a
    // client gets a real conversation.
    const allowed = canStartThread({
      blocked: user.status === 'BLOCKED',
      profileComplete: user.profileCompletedAt !== null,
      engagements: await engagementSnapshots(uow, input.userId),
    });
    if (!allowed.ok) return allowed;

    // Attaching a thread to someone else's engagement would leak its existence.
    if (input.appointmentId) {
      const appointment = await uow.repos.appointments.findById(input.appointmentId);
      if (!appointment || appointment.userId !== input.userId) {
        return err(Errors.notFound('Appointment'));
      }
    }
    if (input.engagementId) {
      const engagement = await uow.repos.itrEngagements.findById(input.engagementId);
      if (!engagement || engagement.userId !== input.userId) {
        return err(Errors.notFound('Engagement'));
      }
    }

    const now = clock.now();

    const thread = await uow.transaction(async (repos) => {
      const created = await repos.messages.createThread({
        userId: input.userId,
        subject: input.subject.trim(),
        appointmentId: input.appointmentId,
        engagementId: input.engagementId,
      });

      await repos.messages.addMessage({
        threadId: created.id,
        senderId: input.userId,
        senderRole: 'USER',
        body: input.body.trim(),
      });

      await repos.messages.touchThread({
        threadId: created.id,
        status: 'AWAITING_ADMIN',
        incrementUnreadFor: 'ADMIN',
        at: now,
      });

      const adminEmails = await repos.users.findAdminEmails();
      await repos.outbox.enqueueMany(
        adminEmails.map((email) => ({
          channel: 'EMAIL' as const,
          recipient: email,
          templateKey: 'message.received' as const,
          payload: {
            threadId: created.id,
            subject: created.subject,
            fromName: user.fullName,
            fromEmail: user.email,
            preview: input.body.slice(0, 200),
          },
          dedupeKey: `thread:${created.id}:new:${email}`,
        })),
      );

      return created;
    });

    return ok(thread);
  }
}

export interface PostMessageInput {
  readonly threadId: string;
  readonly senderId: string;
  readonly senderRole: 'USER' | 'ADMIN';
  readonly body: string;
}

export class PostMessage {
  constructor(private readonly deps: { uow: UnitOfWork; clock: Clock }) {}

  async execute(input: PostMessageInput): Promise<Result<ThreadMessage, DomainError>> {
    const { uow, clock } = this.deps;

    const thread = await uow.repos.messages.findThreadWithUser(input.threadId);
    if (!thread) return err(Errors.notFound('Conversation'));

    const sender = await uow.repos.users.findById(input.senderId);
    if (!sender) return err(Errors.notFound('Account'));

    // Deliberately NOT gated on holding a live engagement. Killing a
    // half-finished conversation because the appointment was cancelled looks
    // tidy in a spec and is infuriating in practice — the cancellation is
    // often exactly what the two of them are discussing.
    const allowed = canReply(
      { blocked: sender.status === 'BLOCKED' },
      { ownerId: thread.userId, status: thread.status },
      input.senderId,
      input.senderRole === 'ADMIN',
    );
    if (!allowed.ok) return allowed;

    const now = clock.now();

    const message = await uow.transaction(async (repos) => {
      const created = await repos.messages.addMessage({
        threadId: thread.id,
        senderId: input.senderId,
        senderRole: input.senderRole,
        body: input.body.trim(),
      });

      // A message in a closed thread reopens it. If someone still has
      // something to say, the practice wants to hear it.
      await repos.messages.touchThread({
        threadId: thread.id,
        status: nextThreadStatus(input.senderRole),
        incrementUnreadFor: input.senderRole === 'USER' ? 'ADMIN' : 'USER',
        at: now,
      });

      const recipients =
        input.senderRole === 'USER'
          ? await repos.users.findAdminEmails()
          : [thread.userEmail];

      await repos.outbox.enqueueMany(
        recipients.map((email) => ({
          channel: 'EMAIL' as const,
          recipient: email,
          templateKey: 'message.received' as const,
          payload: {
            threadId: thread.id,
            subject: thread.subject,
            fromName: input.senderRole === 'ADMIN' ? 'Your CA' : sender.fullName,
            preview: input.body.slice(0, 200),
          },
          dedupeKey: `msg:${created.id}:${email}`,
          // A 15-minute delay: if the other side reads it in the app first,
          // the nudge is pointless. The worker checks read state before sending.
          scheduledFor: new Date(now.getTime() + 15 * 60_000),
        })),
      );

      return created;
    });

    return ok(message);
  }
}

export class MarkThreadRead {
  constructor(private readonly deps: { uow: UnitOfWork; clock: Clock }) {}

  async execute(input: {
    threadId: string;
    readerId: string;
    reader: 'USER' | 'ADMIN';
  }): Promise<Result<void, DomainError>> {
    const { uow, clock } = this.deps;

    const thread = await uow.repos.messages.findThread(input.threadId);
    if (!thread) return err(Errors.notFound('Conversation'));
    if (input.reader === 'USER' && thread.userId !== input.readerId) {
      return err(Errors.notFound('Conversation'));
    }

    await uow.repos.messages.markRead(input.threadId, input.reader, clock.now());
    return ok();
  }
}

export class CloseThread {
  constructor(private readonly deps: { uow: UnitOfWork }) {}

  async execute(threadId: string): Promise<Result<void, DomainError>> {
    const thread = await this.deps.uow.repos.messages.findThread(threadId);
    if (!thread) return err(Errors.notFound('Conversation'));

    await this.deps.uow.repos.messages.setThreadStatus(threadId, 'CLOSED');
    return ok();
  }
}
