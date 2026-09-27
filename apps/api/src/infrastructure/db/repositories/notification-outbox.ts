import type { Querier } from '../querier.js';
import type {
  EnqueueInput,
  NotificationOutbox,
  OutboxChannel,
  OutboxEntry,
  OutboxStatus,
  TemplateKey,
} from '../../../application/ports/notification-outbox.js';

interface OutboxRow {
  id: string;
  channel: OutboxChannel;
  recipient: string;
  template_key: TemplateKey;
  payload: Record<string, unknown>;
  dedupe_key: string | null;
  status: OutboxStatus;
  attempts: number;
  scheduled_for: Date | null;
  last_error: string | null;
  created_at: Date;
}

const COLUMNS = `id, channel, recipient, template_key, payload, dedupe_key, status,
                 attempts, scheduled_for, last_error, created_at`;

function toEntry(row: OutboxRow): OutboxEntry {
  return {
    id: row.id,
    channel: row.channel,
    recipient: row.recipient,
    templateKey: row.template_key,
    payload: row.payload,
    dedupeKey: row.dedupe_key,
    status: row.status,
    attempts: row.attempts,
    scheduledFor: row.scheduled_for,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export class PgNotificationOutbox implements NotificationOutbox {
  constructor(private readonly db: Querier) {}

  /**
   * `on conflict (dedupe_key) do nothing` is what makes sends idempotent:
   * 'apt:<id>:confirmed' can exist only once, so a retried use case or a
   * replayed request cannot email someone twice.
   */
  async enqueue(input: EnqueueInput): Promise<void> {
    await this.db.query(
      `insert into notification_outbox
         (channel, recipient, template_key, payload, dedupe_key, scheduled_for, next_retry_at)
       values ($1, $2, $3, $4::jsonb, $5, $6, coalesce($6, now()))
       on conflict (dedupe_key) do nothing`,
      [
        input.channel,
        input.recipient,
        input.templateKey,
        JSON.stringify(input.payload),
        input.dedupeKey ?? null,
        input.scheduledFor ?? null,
      ],
    );
  }

  async enqueueMany(inputs: readonly EnqueueInput[]): Promise<void> {
    for (const input of inputs) {
      await this.enqueue(input);
    }
  }

  /**
   * `for update skip locked` lets several workers drain the queue at once
   * without two of them picking up the same email. Rows are claimed by being
   * moved out of PENDING in the same statement, so a crash after the claim
   * leaves the row retryable rather than lost.
   */
  async claimBatch(limit: number, now: Date): Promise<OutboxEntry[]> {
    const { rows } = await this.db.query<OutboxRow>(
      `with claimed as (
         select id from notification_outbox
          where status = 'PENDING'
            and next_retry_at <= $2
            and (scheduled_for is null or scheduled_for <= $2)
          order by coalesce(scheduled_for, created_at)
          limit $1
          for update skip locked
       )
       update notification_outbox o
          set attempts = o.attempts + 1
         from claimed
        where o.id = claimed.id
        returning ${COLUMNS.split(', ').map((c) => `o.${c.trim()}`).join(', ')}`,
      [limit, now],
    );
    return rows.map(toEntry);
  }

  async markSent(id: string, at: Date): Promise<void> {
    await this.db.query(
      `update notification_outbox set status = 'SENT', sent_at = $2, last_error = null
        where id = $1`,
      [id, at],
    );
  }

  async markFailed(id: string, error: string, nextRetryAt: Date): Promise<void> {
    await this.db.query(
      `update notification_outbox set status = 'PENDING', last_error = $2, next_retry_at = $3
        where id = $1`,
      [id, error.slice(0, 2000), nextRetryAt],
    );
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.db.query(
      `update notification_outbox set status = 'DEAD', last_error = $2 where id = $1`,
      [id, error.slice(0, 2000)],
    );
  }

  async counts(): Promise<{ pending: number; failed: number; dead: number }> {
    const { rows } = await this.db.query<{ status: OutboxStatus; count: number }>(
      `select status, count(*)::int as count from notification_outbox
        where status <> 'SENT' group by status`,
    );

    const byStatus = new Map(rows.map((r) => [r.status, r.count]));
    return {
      pending: byStatus.get('PENDING') ?? 0,
      failed: byStatus.get('FAILED') ?? 0,
      dead: byStatus.get('DEAD') ?? 0,
    };
  }
}
