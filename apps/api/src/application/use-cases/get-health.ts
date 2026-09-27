import { overallStatus, uptimeSeconds } from '../../domain/health/service-health.js';
import type { DependencyHealth } from '../../domain/health/service-health.js';
import type { Clock } from '../ports/clock.js';
import type { HealthProbe } from '../ports/health-probe.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  environment: string;
  time: string;
  uptimeSeconds: number;
  dependencies: DependencyHealth[];
}

export interface GetHealthDeps {
  clock: Clock;
  probes: readonly HealthProbe[];
  startedAt: Date;
  service: string;
  version: string;
  environment: string;
}

/**
 * Use cases are classes with an `execute` method and no framework imports.
 * Everything they need arrives through the constructor, which is why the unit
 * test below can drive this with a fake clock and a fake probe and no server.
 */
export class GetHealth {
  constructor(private readonly deps: GetHealthDeps) {}

  async execute(): Promise<HealthReport> {
    const { clock, probes, startedAt, service, version, environment } = this.deps;

    // A probe that throws is a degraded dependency, not a 500 on /health —
    // a health endpoint that falls over when something is unhealthy is useless.
    const dependencies = await Promise.all(
      probes.map(async (probe): Promise<DependencyHealth> => {
        try {
          return await probe.check();
        } catch (error) {
          return {
            name: probe.name,
            status: 'degraded',
            detail: error instanceof Error ? error.message : 'probe threw',
          };
        }
      }),
    );

    const now = clock.now();

    return {
      status: overallStatus(dependencies),
      service,
      version,
      environment,
      time: now.toISOString(),
      uptimeSeconds: uptimeSeconds(startedAt, now),
      dependencies,
    };
  }
}
