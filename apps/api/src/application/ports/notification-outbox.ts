/**
 * The transactional outbox.
 *
 * Use cases never send anything. They write a row here, inside the same
 * transaction as the business change, and a worker delivers it afterwards.
 * Forty lines of machinery that remove two failure modes: an appointment saved
 * with no confirmation sent, and a confirmation sent for a booking that rolled
 * back.
 */

export type OutboxChannel = 'EMAIL' | 'SMS';
export type OutboxStatus = 'PENDING' | 'SENT' | 'FAILED' | 'DEAD';

export type TemplateKey =
  | 'appointment.confirmed'
  | 'appointment.reminder'
  | 'appointment.cancelled'
  | 'appointment.rescheduled'
  | 'appointment.meeting_url_changed'
  | 'admin.appointment.booked'
  | 'admin.appointment.cancelled_by_user'
  | 'admin.daily_digest'
  | 'itr.registered'
  | 'itr.info_requested'
  | 'itr.status_changed'
  | 'itr.filed'
  | 'itr.cancelled'
  | 'admin.itr.registered'
  | 'message.received'
  | 'contact.acknowledged'
  | 'admin.contact.received'
  | 'user.welcome';

export interface OutboxEntry {
  readonly id: string;
  readonly channel: OutboxChannel;
  readonly recipient: string;
  readonly templateKey: TemplateKey;
  readonly payload: Record<string, unknown>;
  readonly dedupeKey: string | null;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly scheduledFor: Date | null;
  readonly lastError: string | null;
  readonly createdAt: Date;
}

export interface EnqueueInput {
  readonly channel: OutboxChannel;
  readonly recipient: string;
  readonly templateKey: TemplateKey;
  readonly payload: Record<string, unknown>;
  /**
   * Makes a send idempotent: 'apt:<id>:confirmed' can exist only once, so a
   * retried use case cannot email someone twice.
   */
  readonly dedupeKey?: string | null;
  /** Future-dated rows stay invisible to the worker until their moment. */
  readonly scheduledFor?: Date | null;
}

export interface NotificationOutbox {
  /** Enqueuing a duplicate dedupeKey is a silent no-op, not an error. */
  enqueue(input: EnqueueInput): Promise<void>;
  enqueueMany(inputs: readonly EnqueueInput[]): Promise<void>;

  /**
   * Claim a batch for delivery with FOR UPDATE SKIP LOCKED, so several workers
   * can run without handing the same email to two of them.
   */
  claimBatch(limit: number, now: Date): Promise<OutboxEntry[]>;

  markSent(id: string, at: Date): Promise<void>;
  markFailed(id: string, error: string, nextRetryAt: Date): Promise<void>;
  markDead(id: string, error: string): Promise<void>;

  counts(): Promise<{ pending: number; failed: number; dead: number }>;
}
