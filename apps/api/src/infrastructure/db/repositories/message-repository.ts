import type { Querier } from '../querier.js';
import { SqlBuilder } from '../querier.js';
import type { ThreadStatus } from '../../../domain/messaging/messaging-policy.js';
import type {
  AdminThreadQuery,
  CreateThreadInput,
  MessageRepository,
  Thread,
  ThreadMessage,
  ThreadWithUser,
} from '../../../application/ports/message-repository.js';

interface ThreadRow {
  id: string;
  user_id: string;
  appointment_id: string | null;
  engagement_id: string | null;
  subject: string;
  status: ThreadStatus;
  last_message_at: Date;
  unread_for_admin: number;
  unread_for_user: number;
  created_at: Date;
}

type ThreadUserRow = ThreadRow & {
  user_name: string | null;
  user_email: string;
  last_message_preview: string | null;
};

interface MessageRow {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_role: 'USER' | 'ADMIN';
  body: string;
  read_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id, user_id, appointment_id, engagement_id, subject, status,
                 last_message_at, unread_for_admin, unread_for_user, created_at`;

const WITH_USER = `t.id, t.user_id, t.appointment_id, t.engagement_id, t.subject, t.status,
                   t.last_message_at, t.unread_for_admin, t.unread_for_user, t.created_at,
                   u.full_name as user_name, u.email as user_email,
                   (select left(m.body, 160) from messages m
                     where m.thread_id = t.id order by m.created_at desc limit 1)
                     as last_message_preview`;

function toThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    userId: row.user_id,
    appointmentId: row.appointment_id,
    engagementId: row.engagement_id,
    subject: row.subject,
    status: row.status,
    lastMessageAt: row.last_message_at,
    unreadForAdmin: row.unread_for_admin,
    unreadForUser: row.unread_for_user,
    createdAt: row.created_at,
  };
}

function toThreadWithUser(row: ThreadUserRow): ThreadWithUser {
  return {
    ...toThread(row),
    userName: row.user_name,
    userEmail: row.user_email,
    lastMessagePreview: row.last_message_preview,
  };
}

function toMessage(row: MessageRow): ThreadMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderId: row.sender_id,
    senderRole: row.sender_role,
    body: row.body,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export class PgMessageRepository implements MessageRepository {
  constructor(private readonly db: Querier) {}

  async createThread(input: CreateThreadInput): Promise<Thread> {
    const { rows } = await this.db.query<ThreadRow>(
      `insert into message_threads (user_id, subject, appointment_id, engagement_id)
       values ($1, $2, $3, $4)
       returning ${COLUMNS}`,
      [input.userId, input.subject, input.appointmentId, input.engagementId],
    );
    return toThread(rows[0]!);
  }

  async findThread(id: string): Promise<Thread | null> {
    const { rows } = await this.db.query<ThreadRow>(
      `select ${COLUMNS} from message_threads where id = $1`,
      [id],
    );
    return rows[0] ? toThread(rows[0]) : null;
  }

  async findThreadWithUser(id: string): Promise<ThreadWithUser | null> {
    const { rows } = await this.db.query<ThreadUserRow>(
      `select ${WITH_USER} from message_threads t
         join user_profiles u on u.id = t.user_id
        where t.id = $1`,
      [id],
    );
    return rows[0] ? toThreadWithUser(rows[0]) : null;
  }

  async listThreadsForUser(userId: string): Promise<ThreadWithUser[]> {
    const { rows } = await this.db.query<ThreadUserRow>(
      `select ${WITH_USER} from message_threads t
         join user_profiles u on u.id = t.user_id
        where t.user_id = $1
        order by t.last_message_at desc`,
      [userId],
    );
    return rows.map(toThreadWithUser);
  }

  async listThreadsForAdmin(
    query: AdminThreadQuery,
  ): Promise<{ rows: ThreadWithUser[]; total: number }> {
    const builder = new SqlBuilder();
    builder.whereIf(query.status, 't.status = ?', query.status);

    if (query.q) {
      const term = `%${query.q.toLowerCase()}%`;
      builder.where(
        "(lower(t.subject) like ? or lower(coalesce(u.full_name, '')) like ? or lower(u.email) like ?)",
        term, term, term,
      );
    }

    const where = builder.build();
    const limit = builder.param(query.pageSize);
    const offset = builder.param((query.page - 1) * query.pageSize);

    const { rows } = await this.db.query<ThreadUserRow & { total: number }>(
      `select ${WITH_USER}, count(*) over ()::int as total
         from message_threads t
         join user_profiles u on u.id = t.user_id
         ${where}
        order by
          -- unanswered first: the inbox should open on what needs a reply
          case t.status when 'AWAITING_ADMIN' then 0 when 'AWAITING_USER' then 1 else 2 end,
          t.last_message_at desc
        limit ${limit} offset ${offset}`,
      builder.params,
    );

    return { rows: rows.map(toThreadWithUser), total: rows[0]?.total ?? 0 };
  }

  async addMessage(input: {
    threadId: string;
    senderId: string;
    senderRole: 'USER' | 'ADMIN';
    body: string;
  }): Promise<ThreadMessage> {
    const { rows } = await this.db.query<MessageRow>(
      `insert into messages (thread_id, sender_id, sender_role, body)
       values ($1, $2, $3, $4)
       returning id, thread_id, sender_id, sender_role, body, read_at, created_at`,
      [input.threadId, input.senderId, input.senderRole, input.body],
    );
    return toMessage(rows[0]!);
  }

  async listMessages(threadId: string): Promise<ThreadMessage[]> {
    const { rows } = await this.db.query<MessageRow>(
      `select id, thread_id, sender_id, sender_role, body, read_at, created_at
         from messages where thread_id = $1 order by created_at`,
      [threadId],
    );
    return rows.map(toMessage);
  }

  async touchThread(input: {
    threadId: string;
    status: ThreadStatus;
    incrementUnreadFor: 'USER' | 'ADMIN';
    at: Date;
  }): Promise<void> {
    await this.db.query(
      `update message_threads set
         status = $2,
         last_message_at = $3,
         unread_for_admin = unread_for_admin + case when $4 = 'ADMIN' then 1 else 0 end,
         unread_for_user  = unread_for_user  + case when $4 = 'USER'  then 1 else 0 end
       where id = $1`,
      [input.threadId, input.status, input.at, input.incrementUnreadFor],
    );
  }

  async markRead(threadId: string, reader: 'USER' | 'ADMIN', at: Date): Promise<void> {
    await this.db.query(
      `update message_threads set
         unread_for_admin = case when $2 = 'ADMIN' then 0 else unread_for_admin end,
         unread_for_user  = case when $2 = 'USER'  then 0 else unread_for_user  end
       where id = $1`,
      [threadId, reader],
    );

    // Mark the other side's messages read, not your own.
    await this.db.query(
      `update messages set read_at = $3
        where thread_id = $1 and read_at is null and sender_role <> $2`,
      [threadId, reader, at],
    );
  }

  async setThreadStatus(threadId: string, status: ThreadStatus): Promise<void> {
    await this.db.query('update message_threads set status = $2 where id = $1', [threadId, status]);
  }

  async countUnreadForUser(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `select coalesce(sum(unread_for_user), 0)::int as count
         from message_threads where user_id = $1`,
      [userId],
    );
    return rows[0]?.count ?? 0;
  }

  async countThreadsAwaitingAdmin(): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `select count(*)::int as count from message_threads where status = 'AWAITING_ADMIN'`,
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Messages still unread after the grace period. The nudge email is only
   * worth sending if the recipient has not already seen it in the app, which
   * is why the outbox entry is future-dated and this check runs at send time.
   */
  async findStaleUnread(olderThan: Date): Promise<
    Array<{ threadId: string; subject: string; recipientEmail: string; recipientRole: 'USER' | 'ADMIN' }>
  > {
    const { rows } = await this.db.query<{
      thread_id: string;
      subject: string;
      recipient_email: string;
      recipient_role: 'USER' | 'ADMIN';
    }>(
      `select distinct on (m.thread_id)
              m.thread_id,
              t.subject,
              case when m.sender_role = 'USER' then admin.email else u.email end as recipient_email,
              case when m.sender_role = 'USER' then 'ADMIN' else 'USER' end as recipient_role
         from messages m
         join message_threads t on t.id = m.thread_id
         join user_profiles u on u.id = t.user_id
         cross join lateral (
           select email from user_profiles where role = 'ADMIN' and status = 'ACTIVE' limit 1
         ) admin
        where m.read_at is null and m.created_at < $1
        order by m.thread_id, m.created_at desc`,
      [olderThan],
    );

    return rows.map((row) => ({
      threadId: row.thread_id,
      subject: row.subject,
      recipientEmail: row.recipient_email,
      recipientRole: row.recipient_role,
    }));
  }
}
