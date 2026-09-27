import { describe, expect, it } from 'vitest';
import { overallStatus, uptimeSeconds } from '../../src/domain/health/service-health.js';
import type { DependencyHealth } from '../../src/domain/health/service-health.js';

describe('overallStatus', () => {
  const cases: Array<[string, DependencyHealth[], 'ok' | 'degraded']> = [
    ['no dependencies at all', [], 'ok'],
    ['every dependency healthy', [{ name: 'a', status: 'ok' }, { name: 'b', status: 'ok' }], 'ok'],
    ['one degraded among healthy', [{ name: 'a', status: 'ok' }, { name: 'b', status: 'degraded' }], 'degraded'],
    ['all degraded', [{ name: 'a', status: 'degraded' }], 'degraded'],
  ];

  it.each(cases)('%s → %s', (_label, dependencies, expected) => {
    expect(overallStatus(dependencies)).toBe(expected);
  });
});

describe('uptimeSeconds', () => {
  const start = new Date('2026-09-16T09:00:00+05:30');

  it('counts whole seconds since start', () => {
    expect(uptimeSeconds(start, new Date('2026-09-16T09:00:42+05:30'))).toBe(42);
  });

  it('floors partial seconds rather than rounding up', () => {
    expect(uptimeSeconds(start, new Date(start.getTime() + 1999))).toBe(1);
  });

  it('is zero at the instant of start', () => {
    expect(uptimeSeconds(start, start)).toBe(0);
  });

  it('never returns a negative number when the clock jumps backwards', () => {
    // NTP corrections and fake clocks both do this. A negative uptime in a
    // response body is the kind of thing that gets noticed in production.
    expect(uptimeSeconds(start, new Date(start.getTime() - 60_000))).toBe(0);
  });
});
