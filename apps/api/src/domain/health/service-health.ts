/**
 * Pure domain logic for the health slice.
 *
 * Small, but it earns its place: it is the first proof that a rule can live in
 * `domain/` with no imports, no I/O and no clock, and be tested exhaustively in
 * microseconds. Every later rule — the slot generator, the booking policy, the
 * two state machines — has exactly this shape.
 */

export type HealthStatus = 'ok' | 'degraded';

export interface DependencyHealth {
  readonly name: string;
  readonly status: HealthStatus;
  readonly detail?: string;
}

/**
 * The service is only as healthy as its least healthy dependency.
 * No dependencies means nothing can be degraded, so the service is ok.
 */
export function overallStatus(dependencies: readonly DependencyHealth[]): HealthStatus {
  return dependencies.some((d) => d.status === 'degraded') ? 'degraded' : 'ok';
}

/**
 * Uptime in whole seconds, never negative — a clock that jumps backwards
 * (NTP correction, a fake clock in a test) must not produce a negative number
 * in a response body.
 */
export function uptimeSeconds(startedAt: Date, now: Date): number {
  const elapsedMs = now.getTime() - startedAt.getTime();
  return Math.max(0, Math.floor(elapsedMs / 1000));
}
