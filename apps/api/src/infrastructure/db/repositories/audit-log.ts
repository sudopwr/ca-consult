import type { Querier } from '../querier.js';
import type { AuditEntry, AuditLog } from '../../../application/ports/audit-log.js';

/**
 * Keys whose values never reach the audit table in the clear, whatever a
 * caller passes. The use cases already mask PANs before recording, but a
 * second layer here means a future caller cannot leak one by forgetting.
 */
const REDACTED_KEYS = new Set(['pan', 'panNumber', 'pan_number', 'password', 'token', 'secret']);

function redact(diff: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!diff) return null;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(diff)) {
    if (value === undefined) continue;

    if (REDACTED_KEYS.has(key) && typeof value === 'string') {
      // Already-masked values pass through; anything else is flattened.
      output[key] = value.includes('*') ? value : '[redacted]';
      continue;
    }

    output[key] =
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? redact(value as Record<string, unknown>)
        : value;
  }
  return output;
}

export class PgAuditLog implements AuditLog {
  constructor(private readonly db: Querier) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.db.query(
      `insert into audit_log (actor_id, action, entity_type, entity_id, diff, ip)
       values ($1, $2, $3, $4, $5::jsonb, $6::inet)`,
      [
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId,
        JSON.stringify(redact(entry.diff)),
        entry.ip ?? null,
      ],
    );
  }
}
