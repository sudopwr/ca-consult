import type { DependencyHealth } from '../../domain/health/service-health.js';

/**
 * One checkable dependency. Slice 1 ships only the process probe; the Supabase
 * probe arrives with the first repository, and the outbox-lag probe with slice 10.
 * The route never changes when probes are added — only the composition root does.
 */
export interface HealthProbe {
  readonly name: string;
  check(): Promise<DependencyHealth>;
}
