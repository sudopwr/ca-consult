import type { HealthProbe } from '../../application/ports/health-probe.js';
import type { DependencyHealth } from '../../domain/health/service-health.js';
import type { Querier } from '../db/querier.js';

/** Degraded, not failed: /health must still answer when the database is down. */
export class DatabaseProbe implements HealthProbe {
  readonly name = 'database';

  constructor(
    private readonly db: Querier,
    private readonly timeoutMs = 2_000,
  ) {}

  async check(): Promise<DependencyHealth> {
    const started = Date.now();

    try {
      await Promise.race([
        this.db.query('select 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timed out')), this.timeoutMs),
        ),
      ]);

      const elapsed = Date.now() - started;
      // A healthy Supabase round trip is single-digit milliseconds. Hundreds
      // means connection-pool contention worth knowing about before clients do.
      return elapsed > 500
        ? { name: this.name, status: 'degraded', detail: `slow: ${elapsed}ms` }
        : { name: this.name, status: 'ok' };
    } catch (error) {
      return {
        name: this.name,
        status: 'degraded',
        detail: error instanceof Error ? error.message : 'unreachable',
      };
    }
  }
}

/**
 * The outbox is the system's one piece of asynchrony, so a backlog is the
 * first sign the worker has stopped or a provider is rejecting everything.
 */
export class OutboxProbe implements HealthProbe {
  readonly name = 'outbox';

  constructor(
    private readonly counts: () => Promise<{ pending: number; failed: number; dead: number }>,
    private readonly pendingThreshold = 200,
  ) {}

  async check(): Promise<DependencyHealth> {
    const { pending, dead } = await this.counts();

    if (dead > 0) {
      return { name: this.name, status: 'degraded', detail: `${dead} undeliverable` };
    }
    if (pending > this.pendingThreshold) {
      return { name: this.name, status: 'degraded', detail: `${pending} queued` };
    }
    return { name: this.name, status: 'ok' };
  }
}
