export interface AuditEntry {
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly diff?: Record<string, unknown> | null;
  readonly ip?: string | null;
}

export interface AuditLog {
  /**
   * Records an admin mutation. The writer redacts sensitive values before the
   * diff is stored — a PAN must never reach this table in the clear.
   */
  record(entry: AuditEntry): Promise<void>;
}
