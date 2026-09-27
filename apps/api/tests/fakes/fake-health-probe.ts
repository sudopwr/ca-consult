import type { HealthProbe } from '../../src/application/ports/health-probe.js';
import type { DependencyHealth, HealthStatus } from '../../src/domain/health/service-health.js';

export class FakeHealthProbe implements HealthProbe {
  constructor(
    readonly name: string,
    private status: HealthStatus = 'ok',
    private readonly throws: Error | null = null,
  ) {}

  static throwing(name: string, message: string): FakeHealthProbe {
    return new FakeHealthProbe(name, 'ok', new Error(message));
  }

  setStatus(status: HealthStatus): void {
    this.status = status;
  }

  async check(): Promise<DependencyHealth> {
    if (this.throws) throw this.throws;
    return { name: this.name, status: this.status };
  }
}
