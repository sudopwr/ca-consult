import type { ThreadStatus } from '../../domain/messaging/messaging-policy.js';

export interface Thread {
  readonly id: string;
  readonly userId: string;
  readonly appointmentId: string | null;
  readonly engagementId: string | null;
  readonly subject: string;
  readonly status: ThreadStatus;
  readonly lastMessageAt: Date;
  readonly unreadForAdmin: number;
  readonly unreadForUser: number;
  readonly createdAt: Date;
}

export interface ThreadMessage {
  readonly id: string;
  readonly threadId: string;
  readonly senderId: string;
  readonly senderRole: 'USER' | 'ADMIN';
  readonly body: string;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface ThreadWithUser extends Thread {
  readonly userName: string | null;
  readonly userEmail: string;
  readonly lastMessagePreview: string | null;
}

export interface CreateThreadInput {
  readonly userId: string;
  readonly subject: string;
  readonly appointmentId: string | null;
  readonly engagementId: string | null;
}

export interface AdminThreadQuery {
  readonly status?: ThreadStatus | undefined;
  readonly q?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
}

export interface MessageRepository {
  createThread(input: CreateThreadInput): Promise<Thread>;
  findThread(id: string): Promise<Thread | null>;
  findThreadWithUser(id: string): Promise<ThreadWithUser | null>;

  listThreadsForUser(userId: string): Promise<ThreadWithUser[]>;
  listThreadsForAdmin(query: AdminThreadQuery): Promise<{ rows: ThreadWithUser[]; total: number }>;

  addMessage(input: {
    threadId: string;
    senderId: string;
    senderRole: 'USER' | 'ADMIN';
    body: string;
  }): Promise<ThreadMessage>;

  listMessages(threadId: string): Promise<ThreadMessage[]>;

  /** Called after posting: moves the ball and bumps the other side's counter. */
  touchThread(input: {
    threadId: string;
    status: ThreadStatus;
    incrementUnreadFor: 'USER' | 'ADMIN';
    at: Date;
  }): Promise<void>;

  markRead(threadId: string, reader: 'USER' | 'ADMIN', at: Date): Promise<void>;
  setThreadStatus(threadId: string, status: ThreadStatus): Promise<void>;

  countUnreadForUser(userId: string): Promise<number>;
  countThreadsAwaitingAdmin(): Promise<number>;

  /** Messages unread for longer than the grace period — drives nudge emails. */
  findStaleUnread(olderThan: Date): Promise<
    Array<{ threadId: string; subject: string; recipientEmail: string; recipientRole: 'USER' | 'ADMIN' }>
  >;
}
