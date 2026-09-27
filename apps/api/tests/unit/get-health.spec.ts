import { describe, expect, it } from 'vitest';
import { GetHealth } from '../../src/application/use-cases/get-health.js';
import { FakeClock } from '../fakes/fake-clock.js';
import { FakeHealthProbe } from '../fakes/fake-health-probe.js';

function makeUseCase(probes: FakeHealthProbe[], clock = new FakeClock('2026-09-16T09:00:00+05:30')) {
  return new GetHealth({
    clock,
    probes,
    startedAt: new Date('2026-09-16T08:55:00+05:30'),
    service: 'ca-consult-api',
    version: '0.1.0',
    environment: 'test',
  });
}

describe('GetHealth', () => {
  it('reports ok with uptime taken from the injected clock', async () => {
    const report = await makeUseCase([new FakeHealthProbe('db')]).execute();

    expect(report.status).toBe('ok');
    expect(report.uptimeSeconds).toBe(300); // exactly five minutes, no real waiting
    expect(report.time).toBe('2026-09-16T03:30:00.000Z');
    expect(report.dependencies).toEqual([{ name: 'db', status: 'ok' }]);
  });

  it('is degraded when any probe reports degraded', async () => {
    const report = await makeUseCase([
      new FakeHealthProbe('db'),
      new FakeHealthProbe('outbox', 'degraded'),
    ]).execute();

    expect(report.status).toBe('degraded');
  });

  it('treats a probe that throws as a degraded dependency, not a crash', async () => {
    // A health endpoint that 500s when something is unhealthy tells you
    // nothing at the moment you most need it to.
    const report = await makeUseCase([
      new FakeHealthProbe('db'),
      FakeHealthProbe.throwing('supabase', 'ECONNREFUSED'),
    ]).execute();

    expect(report.status).toBe('degraded');
    expect(report.dependencies).toContainEqual({
      name: 'supabase',
      status: 'degraded',
      detail: 'ECONNREFUSED',
    });
  });

  it('is ok when there are no probes registered', async () => {
    const report = await makeUseCase([]).execute();
    expect(report.status).toBe('ok');
    expect(report.dependencies).toEqual([]);
  });

  it('advances uptime with the clock', async () => {
    const clock = new FakeClock('2026-09-16T09:00:00+05:30');
    const useCase = makeUseCase([], clock);

    clock.advanceHours(2);

    expect((await useCase.execute()).uptimeSeconds).toBe(2 * 3600 + 300);
  });
});
