import type { Clock } from '../application/ports/clock.js';

/**
 * The only place in the API allowed to call `new Date()`.
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
