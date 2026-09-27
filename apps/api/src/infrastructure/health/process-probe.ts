import type { HealthProbe } from '../../application/ports/health-probe.js';
import type { DependencyHealth } from '../../domain/health/service-health.js';

/**
 * Reports the process itself: heap headroom. Degraded above 90% of the heap
 * limit, which is the point at which GC pressure starts showing up as latency.
 */
export class ProcessProbe implements HealthProbe {
  readonly name = 'process';

  constructor(private readonly threshold = 0.9) {}

  async check(): Promise<DependencyHealth> {
    const { heapUsed, heapTotal } = process.memoryUsage();
    const ratio = heapTotal === 0 ? 0 : heapUsed / heapTotal;

    return ratio > this.threshold
      ? {
          name: this.name,
          status: 'degraded',
          detail: `heap at ${(ratio * 100).toFixed(0)}%`,
        }
      : { name: this.name, status: 'ok' };
  }
}
