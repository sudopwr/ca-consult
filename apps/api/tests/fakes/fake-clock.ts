import type { Clock } from '../../src/application/ports/clock.js';

/**
 * A real implementation of the Clock port, not a mocking-library stub.
 *
 * Every test that involves time uses this: the 12-hour cancellation window,
 * the 120-minute booking lead time, the 24-hour reminder. `advance()` makes
 * "what happens 13 hours later" a one-line assertion instead of a timer.
 */
export class FakeClock implements Clock {
  private current: Date;

  constructor(iso: string | Date = '2026-09-16T09:00:00+05:30') {
    this.current = typeof iso === 'string' ? new Date(iso) : iso;
  }

  now(): Date {
    return new Date(this.current);
  }

  set(iso: string | Date): void {
    this.current = typeof iso === 'string' ? new Date(iso) : iso;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceHours(hours: number): void {
    this.advance(hours * 60 * 60 * 1000);
  }
}
